"""Anthropic provider implementation using the official async SDK."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import anthropic
from anthropic import AsyncAnthropic

from src.backend.exceptions import ProviderError
from src.backend.providers.base import (
    ChatMessage,
    CompletionResult,
    StreamEvent,
    ToolCallData,
)

logger = logging.getLogger(__name__)


def _translate_messages(
    messages: list[ChatMessage],
) -> tuple[str | None, list[dict]]:
    """Convert ChatMessage list to Anthropic API format.

    Returns (system_prompt, messages) where system_prompt is extracted
    from any system-role messages and messages are in Anthropic's
    strict user/assistant alternation format.
    """
    system_parts: list[str] = []
    translated: list[dict] = []

    for msg in messages:
        if msg.role == "system":
            if msg.content:
                system_parts.append(msg.content)
            continue

        if msg.role == "tool_call":
            # Reconstruct as assistant message with tool_use content blocks
            content_blocks: list[dict] = []
            if msg.content:
                content_blocks.append({"type": "text", "text": msg.content})
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    content_blocks.append(
                        {
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.name,
                            "input": json.loads(tc.arguments),
                        }
                    )
            translated.append({"role": "assistant", "content": content_blocks})

        elif msg.role == "tool_result":
            # Tool results go as user-role messages with tool_result block
            translated.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": msg.tool_call_id or "",
                            "content": msg.content or "",
                        }
                    ],
                }
            )

        else:
            # user or assistant — simple text
            translated.append(
                {"role": msg.role, "content": msg.content or ""}
            )

    # Merge consecutive same-role messages (Anthropic requires strict alternation)
    merged: list[dict] = []
    for entry in translated:
        if merged and merged[-1]["role"] == entry["role"]:
            prev_content = merged[-1]["content"]
            new_content = entry["content"]

            # Normalize both to list-of-blocks form for merging
            if isinstance(prev_content, str):
                prev_content = [{"type": "text", "text": prev_content}]
            if isinstance(new_content, str):
                new_content = [{"type": "text", "text": new_content}]

            merged[-1]["content"] = prev_content + new_content
        else:
            merged.append(entry)

    system_text = "\n\n".join(system_parts) if system_parts else None
    return system_text, merged


def _build_thinking_param(reasoning_level: str | None) -> dict | None:
    """Map Wayne reasoning level to Anthropic thinking config."""
    if not reasoning_level or reasoning_level == "off":
        return None

    if reasoning_level == "adaptive":
        return {"type": "adaptive"}

    # low/medium/high → adaptive thinking (Anthropic doesn't have a
    # direct effort mapping like OpenAI; adaptive is recommended)
    return {"type": "adaptive"}


class AnthropicProvider:
    """Anthropic LLM provider via the official SDK."""

    def __init__(self, api_key: str) -> None:
        self._client = AsyncAnthropic(api_key=api_key)

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        system_text, translated = _translate_messages(messages)

        kwargs: dict = {
            "model": model_id,
            "messages": translated,
            "max_tokens": 8192,
        }

        if system_text:
            kwargs["system"] = system_text

        thinking = _build_thinking_param(reasoning_level)
        if thinking:
            kwargs["thinking"] = thinking

        if tools:
            kwargs["tools"] = tools

        try:
            async with self._client.messages.stream(**kwargs) as stream:
                pending_tool: dict | None = None

                async for event in stream:
                    if event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "thinking":
                            pass  # Thinking content comes via deltas
                        elif block.type == "tool_use":
                            pending_tool = {
                                "id": block.id,
                                "name": block.name,
                                "arguments": "",
                            }

                    elif event.type == "content_block_delta":
                        delta = event.delta
                        if delta.type == "thinking_delta":
                            yield StreamEvent(type="reasoning", content=delta.thinking)
                        elif delta.type == "text_delta":
                            yield StreamEvent(type="token", content=delta.text)
                        elif delta.type == "input_json_delta":
                            if pending_tool is not None:
                                pending_tool["arguments"] += delta.partial_json

                    elif event.type == "content_block_stop":
                        if pending_tool is not None:
                            yield StreamEvent(
                                type="tool_call",
                                tool_call=ToolCallData(
                                    id=pending_tool["id"],
                                    name=pending_tool["name"],
                                    arguments=pending_tool["arguments"],
                                ),
                            )
                            pending_tool = None

                    elif event.type == "message_stop":
                        final_message = stream.get_final_message()
                        usage = None
                        if final_message and final_message.usage:
                            usage = {
                                "prompt_tokens": final_message.usage.input_tokens,
                                "completion_tokens": final_message.usage.output_tokens,
                            }
                        yield StreamEvent(
                            type="done",
                            metadata={
                                "finish_reason": final_message.stop_reason if final_message else None,
                                "usage": usage,
                            },
                        )

        except anthropic.APIError as e:
            yield StreamEvent(type="error", error=f"Anthropic API error: {e.message}")

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict | None = None,
    ) -> CompletionResult:
        system_text, translated = _translate_messages(messages)

        kwargs: dict = {
            "model": model_id,
            "messages": translated,
            "max_tokens": 8192,
        }

        if system_text:
            kwargs["system"] = system_text

        try:
            response = await self._client.messages.create(**kwargs)
        except anthropic.APIError as e:
            raise ProviderError(f"Anthropic API error: {e.message}") from e

        # Extract text content from response content blocks
        text_parts: list[str] = []
        tool_calls: list[ToolCallData] = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCallData(
                        id=block.id,
                        name=block.name,
                        arguments=json.dumps(block.input),
                    )
                )

        metadata: dict = {"finish_reason": response.stop_reason}
        if response.usage:
            metadata["usage"] = {
                "prompt_tokens": response.usage.input_tokens,
                "completion_tokens": response.usage.output_tokens,
            }

        return CompletionResult(
            content="\n".join(text_parts),
            tool_calls=tool_calls or None,
            metadata=metadata,
        )
