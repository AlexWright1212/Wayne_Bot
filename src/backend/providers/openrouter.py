"""OpenRouter provider implementation using httpx (OpenAI-compatible API)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import httpx

from src.backend.exceptions import ProviderError
from src.backend.providers.base import (
    ChatMessage,
    CompletionResult,
    StreamEvent,
    ToolCallData,
)

logger = logging.getLogger(__name__)

_BASE_URL = "https://openrouter.ai/api/v1"


def _translate_messages(messages: list[ChatMessage]) -> list[dict]:
    """Convert ChatMessage list to OpenAI-compatible format (same as OpenAI provider)."""
    result: list[dict] = []
    for msg in messages:
        if msg.role == "tool_call":
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


def _parse_sse_line(line: str) -> dict | None:
    """Parse a single SSE data line into a dict, or None for non-data lines."""
    line = line.strip()
    if not line or line.startswith(":"):
        return None
    if not line.startswith("data: "):
        return None
    data = line[6:]
    if data == "[DONE]":
        return None
    try:
        return json.loads(data)
    except json.JSONDecodeError:
        logger.warning("Failed to parse SSE data: %s", data[:200])
        return None


class OpenRouterProvider:
    """OpenRouter LLM provider via httpx (OpenAI-compatible API)."""

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._client = httpx.AsyncClient(
            base_url=_BASE_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": "https://wayne-bot.local",
                "X-Title": "Wayne",
                "Content-Type": "application/json",
            },
            timeout=120.0,
        )

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        translated = _translate_messages(messages)

        body: dict = {
            "model": model_id,
            "messages": translated,
            "stream": True,
        }

        if tools:
            body["tools"] = tools

        try:
            async with self._client.stream(
                "POST", "/chat/completions", json=body
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    raise ProviderError(
                        f"OpenRouter API error ({response.status_code}): {error_body.decode()[:500]}"
                    )

                # State for DeepSeek R1 <think> tag parsing
                in_think_block = False
                # State for tool call accumulation
                pending_tool_calls: dict[int, dict] = {}
                finish_reason: str | None = None

                async for line in response.aiter_lines():
                    parsed = _parse_sse_line(line)
                    if parsed is None:
                        continue

                    choices = parsed.get("choices", [])
                    if not choices:
                        continue
                    choice = choices[0]
                    delta = choice.get("delta", {})
                    finish_reason = choice.get("finish_reason") or finish_reason

                    # Tool call deltas
                    tc_deltas = delta.get("tool_calls")
                    if tc_deltas:
                        for tc_delta in tc_deltas:
                            idx = tc_delta.get("index", 0)
                            if idx not in pending_tool_calls:
                                pending_tool_calls[idx] = {"id": "", "name": "", "arguments": ""}
                            if tc_delta.get("id"):
                                pending_tool_calls[idx]["id"] = tc_delta["id"]
                            func = tc_delta.get("function", {})
                            if func.get("name"):
                                pending_tool_calls[idx]["name"] = func["name"]
                            if func.get("arguments"):
                                pending_tool_calls[idx]["arguments"] += func["arguments"]

                    # Text content with DeepSeek R1 <think> tag parsing
                    content = delta.get("content") or ""
                    if content:
                        # Process content character-by-character for think tags
                        remaining = content
                        while remaining:
                            if not in_think_block:
                                think_start = remaining.find("<think>")
                                if think_start == -1:
                                    yield StreamEvent(type="token", content=remaining)
                                    remaining = ""
                                else:
                                    if think_start > 0:
                                        yield StreamEvent(type="token", content=remaining[:think_start])
                                    in_think_block = True
                                    remaining = remaining[think_start + 7:]  # len("<think>")
                            else:
                                think_end = remaining.find("</think>")
                                if think_end == -1:
                                    yield StreamEvent(type="reasoning", content=remaining)
                                    remaining = ""
                                else:
                                    if think_end > 0:
                                        yield StreamEvent(type="reasoning", content=remaining[:think_end])
                                    in_think_block = False
                                    remaining = remaining[think_end + 8:]  # len("</think>")

                    # Check for finish
                    if choice.get("finish_reason"):
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

                        usage = parsed.get("usage")
                        usage_dict = None
                        if usage:
                            usage_dict = {
                                "prompt_tokens": usage.get("prompt_tokens"),
                                "completion_tokens": usage.get("completion_tokens"),
                            }

                        yield StreamEvent(
                            type="done",
                            metadata={
                                "finish_reason": finish_reason,
                                "usage": usage_dict,
                            },
                        )

        except httpx.HTTPError as e:
            yield StreamEvent(type="error", error=f"OpenRouter HTTP error: {e}")
        except ProviderError:
            raise

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict | None = None,
    ) -> CompletionResult:
        translated = _translate_messages(messages)

        body: dict = {
            "model": model_id,
            "messages": translated,
        }

        if response_format:
            body["response_format"] = response_format

        try:
            response = await self._client.post("/chat/completions", json=body)
        except httpx.HTTPError as e:
            raise ProviderError(f"OpenRouter HTTP error: {e}") from e

        if response.status_code != 200:
            raise ProviderError(
                f"OpenRouter API error ({response.status_code}): {response.text[:500]}"
            )

        data = response.json()
        choice = data["choices"][0]
        content = choice.get("message", {}).get("content") or ""

        tool_calls = None
        raw_tcs = choice.get("message", {}).get("tool_calls")
        if raw_tcs:
            tool_calls = [
                ToolCallData(
                    id=tc["id"],
                    name=tc["function"]["name"],
                    arguments=tc["function"]["arguments"],
                )
                for tc in raw_tcs
            ]

        usage = data.get("usage")
        metadata: dict = {"finish_reason": choice.get("finish_reason")}
        if usage:
            metadata["usage"] = {
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
            }

        return CompletionResult(content=content, tool_calls=tool_calls, metadata=metadata)
