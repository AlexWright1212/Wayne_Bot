"""OpenAI provider implementation using the official async SDK."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import openai
from openai import AsyncOpenAI

from src.backend.exceptions import ProviderError
from src.backend.providers.base import (
    ChatMessage,
    CompletionResult,
    StreamEvent,
    ToolCallData,
)

logger = logging.getLogger(__name__)


def _translate_messages(messages: list[ChatMessage]) -> list[dict]:
    """Convert ChatMessage list to OpenAI API message format."""
    result: list[dict] = []
    for msg in messages:
        if msg.role == "tool_call":
            # Reconstruct as assistant message with tool_calls
            tool_calls = []
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_calls.append(
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": tc.arguments,
                            },
                        }
                    )
            result.append(
                {
                    "role": "assistant",
                    "content": msg.content,
                    "tool_calls": tool_calls,
                }
            )
        elif msg.role == "tool_result":
            result.append(
                {
                    "role": "tool",
                    "content": msg.content or "",
                    "tool_call_id": msg.tool_call_id or "",
                }
            )
        else:
            result.append({"role": msg.role, "content": msg.content or ""})
    return result


class OpenAIProvider:
    """OpenAI LLM provider via the official SDK."""

    def __init__(self, api_key: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        translated = _translate_messages(messages)

        kwargs: dict = {
            "model": model_id,
            "messages": translated,
            "stream": True,
        }

        # Reasoning
        use_reasoning = reasoning_level and reasoning_level != "none"
        if use_reasoning:
            kwargs["reasoning"] = {"effort": reasoning_level}

        # Tools
        if tools:
            kwargs["tools"] = tools

        try:
            stream = await self._client.chat.completions.create(**kwargs)
        except openai.APIError as e:
            raise ProviderError(f"OpenAI API error: {e.message}") from e

        # Accumulate tool call fragments across chunks
        pending_tool_calls: dict[int, dict] = {}  # index -> {id, name, arguments}

        try:
            async for chunk in stream:
                choice = chunk.choices[0] if chunk.choices else None
                if not choice:
                    continue

                delta = choice.delta

                # Reasoning content
                if hasattr(delta, "reasoning") and delta.reasoning:
                    if hasattr(delta.reasoning, "content") and delta.reasoning.content:
                        yield StreamEvent(type="reasoning", content=delta.reasoning.content)

                # Text content
                if delta.content:
                    yield StreamEvent(type="token", content=delta.content)

                # Tool call deltas — accumulate fragments
                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in pending_tool_calls:
                            pending_tool_calls[idx] = {"id": "", "name": "", "arguments": ""}
                        if tc_delta.id:
                            pending_tool_calls[idx]["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                pending_tool_calls[idx]["name"] = tc_delta.function.name
                            if tc_delta.function.arguments:
                                pending_tool_calls[idx]["arguments"] += tc_delta.function.arguments

                # When the stream finishes, emit tool calls and done event
                if choice.finish_reason:
                    for _idx in sorted(pending_tool_calls.keys()):
                        tc_data = pending_tool_calls[_idx]
                        yield StreamEvent(
                            type="tool_call",
                            tool_call=ToolCallData(
                                id=tc_data["id"],
                                name=tc_data["name"],
                                arguments=tc_data["arguments"],
                            ),
                        )

                    usage = None
                    if chunk.usage:
                        usage = {
                            "prompt_tokens": chunk.usage.prompt_tokens,
                            "completion_tokens": chunk.usage.completion_tokens,
                        }

                    yield StreamEvent(
                        type="done",
                        metadata={
                            "finish_reason": choice.finish_reason,
                            "usage": usage,
                        },
                    )
        except openai.APIError as e:
            yield StreamEvent(type="error", error=f"OpenAI stream error: {e.message}")

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict | None = None,
    ) -> CompletionResult:
        translated = _translate_messages(messages)

        kwargs: dict = {
            "model": model_id,
            "messages": translated,
        }

        if response_format:
            kwargs["response_format"] = response_format

        try:
            response = await self._client.chat.completions.create(**kwargs)
        except openai.APIError as e:
            raise ProviderError(f"OpenAI API error: {e.message}") from e

        choice = response.choices[0]
        content = choice.message.content or ""

        tool_calls = None
        if choice.message.tool_calls:
            tool_calls = [
                ToolCallData(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=tc.function.arguments,
                )
                for tc in choice.message.tool_calls
            ]

        metadata: dict = {"finish_reason": choice.finish_reason}
        if response.usage:
            metadata["usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
            }

        return CompletionResult(content=content, tool_calls=tool_calls, metadata=metadata)
