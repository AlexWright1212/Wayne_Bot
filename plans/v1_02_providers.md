# Unit P — Provider Layer Implementation Plan

**Parent:** `plans/v1_master_plan.md` → Unit P
**Spec sections:** §3.1, §3.2, §3.3, §8.1
**Model reference:** `docs/llm_models_reference.md`
**Depends on:** Unit F (config.py, exceptions.py, main.py)
**Date:** 2026-03-03

---

## 1. Overview

Unit P implements the LLM provider abstraction layer — the core types (`ChatMessage`, `StreamEvent`, `ToolCallData`, `CompletionResult`), the `LLMProvider` protocol, three concrete provider implementations (OpenAI, Anthropic, OpenRouter), a provider registry, a model catalog, and the `GET /api/models` endpoint.

### Completion Criteria

- [ ] `LLMProvider` protocol defined with `stream_chat()` and `complete()` methods
- [ ] `ChatMessage`, `StreamEvent`, `ToolCallData`, `CompletionResult` dataclasses defined
- [ ] `OpenAIProvider` implements `stream_chat()` and `complete()` using the OpenAI Python SDK
- [ ] `AnthropicProvider` implements `stream_chat()` and `complete()` using the Anthropic Python SDK
- [ ] `OpenRouterProvider` implements `stream_chat()` and `complete()` using httpx (OpenAI-compatible REST)
- [ ] `ProviderRegistry` maps provider names to instances, validates API keys
- [ ] `ModelCatalog` provides static model metadata + dynamic OpenRouter model fetching
- [ ] `GET /api/models` returns all available models grouped by provider
- [ ] Unit tests with `respx` for each provider: normal response, reasoning response, tool call response
- [ ] All tests pass with no real API calls

---

## 2. Dependencies (Poetry)

Add to `pyproject.toml`:

```toml
[tool.poetry.dependencies]
openai = "^1.60"
anthropic = "^0.45"
httpx = "^0.28"
tiktoken = "^0.9"

[tool.poetry.group.dev.dependencies]
respx = "^0.22"
pytest-asyncio = "^0.25"
```

---

## 3. File-by-File Implementation

### 3.1 `src/backend/providers/__init__.py`

```python
from .base import (
    ChatMessage,
    CompletionResult,
    LLMProvider,
    StreamEvent,
    ToolCallData,
)
from .registry import ProviderRegistry
from .model_catalog import ModelCatalog

__all__ = [
    "ChatMessage",
    "CompletionResult",
    "LLMProvider",
    "ModelCatalog",
    "ProviderRegistry",
    "StreamEvent",
    "ToolCallData",
]
```

---

### 3.2 `src/backend/providers/base.py`

This file defines all shared types and the `LLMProvider` protocol. These types flow through the entire system — chat service, WebSocket, visibility, tools.

```python
"""Provider abstraction types — the foundation of Wayne's LLM integration."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class ToolCallData:
    """Represents a single tool call returned by the LLM."""
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ChatMessage:
    """Unified message format used throughout the system.

    This is the internal representation. Each provider translates to/from
    its own wire format in its implementation.
    """
    role: Literal["user", "assistant", "system", "tool_call", "tool_result"]
    content: str | None = None
    tool_calls: list[ToolCallData] | None = None
    # For tool_result messages: link back to the tool call
    tool_call_id: str | None = None
    tool_name: str | None = None


@dataclass
class StreamEvent:
    """A single event emitted during streaming.

    The chat service and WebSocket handler consume these to build
    the response and push real-time updates to the frontend.
    """
    type: Literal["token", "tool_call", "reasoning", "done", "error"]
    content: str = ""
    tool_call: ToolCallData | None = None
    metadata: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class CompletionResult:
    """Result of a non-streaming completion (used by lightweight model calls)."""
    content: str
    model_id: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    finish_reason: str | None = None
    raw_response: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Tool schema type alias (JSON Schema dict passed to providers)
# ---------------------------------------------------------------------------

ToolSchema = dict[str, Any]


# ---------------------------------------------------------------------------
# LLMProvider protocol
# ---------------------------------------------------------------------------

class LLMProvider(Protocol):
    """Protocol that all LLM provider implementations must satisfy.

    Uses structural subtyping — providers don't inherit from this class,
    they just implement the same method signatures.
    """

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[ToolSchema] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Stream a chat completion, yielding StreamEvents.

        Args:
            messages: Conversation history in ChatMessage format.
            model_id: The provider-specific model identifier.
            reasoning_level: Provider-specific reasoning control value, or None.
            tools: Optional list of tool schemas in the provider's expected format.

        Yields:
            StreamEvent instances: token, reasoning, tool_call, done, or error.
        """
        ...

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict[str, Any] | None = None,
    ) -> CompletionResult:
        """Non-streaming completion (for lightweight model utility calls).

        Args:
            messages: Conversation history in ChatMessage format.
            model_id: The provider-specific model identifier.
            response_format: Optional structured output format (e.g. JSON mode).

        Returns:
            CompletionResult with the model's response.
        """
        ...
```

---

### 3.3 `src/backend/providers/openai.py`

```python
"""OpenAI provider — direct SDK integration.

Models: gpt-5.2, gpt-5, gpt-5-mini, gpt-5-nano
Reasoning: reasoning.effort parameter (none, low, medium, high, xhigh)
Tool calling: native function calling
Streaming: SSE via SDK
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from src.backend.config import Settings
from src.backend.exceptions import ProviderError, ProviderKeyMissing

from .base import (
    ChatMessage,
    CompletionResult,
    StreamEvent,
    ToolCallData,
    ToolSchema,
)

logger = logging.getLogger(__name__)


class OpenAIProvider:
    """OpenAI LLM provider using the official Python SDK."""

    PROVIDER_NAME = "openai"

    def __init__(self, settings: Settings) -> None:
        if not settings.openai_api_key:
            raise ProviderKeyMissing("OpenAI API key is not configured")
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)

    # ------------------------------------------------------------------
    # Message translation
    # ------------------------------------------------------------------

    @staticmethod
    def _to_openai_messages(
        messages: list[ChatMessage],
    ) -> list[dict[str, Any]]:
        """Convert internal ChatMessage list to OpenAI's message format."""
        result: list[dict[str, Any]] = []
        for msg in messages:
            if msg.role == "tool_call":
                # Assistant message that contains tool calls
                tool_calls_payload = []
                for tc in msg.tool_calls or []:
                    tool_calls_payload.append({
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments),
                        },
                    })
                result.append({
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": tool_calls_payload,
                })
            elif msg.role == "tool_result":
                result.append({
                    "role": "tool",
                    "tool_call_id": msg.tool_call_id or "",
                    "content": msg.content or "",
                })
            else:
                result.append({
                    "role": msg.role,
                    "content": msg.content or "",
                })
        return result

    @staticmethod
    def _build_tools_param(
        tools: list[ToolSchema] | None,
    ) -> list[dict[str, Any]] | None:
        """Convert tool schemas to OpenAI function calling format."""
        if not tools:
            return None
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("parameters", {}),
                },
            }
            for t in tools
        ]

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[ToolSchema] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Stream a chat completion from OpenAI."""
        openai_messages = self._to_openai_messages(messages)
        tools_param = self._build_tools_param(tools)

        kwargs: dict[str, Any] = {
            "model": model_id,
            "messages": openai_messages,
            "stream": True,
        }

        # Reasoning control — maps to reasoning.effort
        if reasoning_level and reasoning_level != "none":
            kwargs["reasoning"] = {"effort": reasoning_level}
            # Opt into reasoning summaries for visibility layer
            kwargs["reasoning"]["summary"] = "concise"

        if tools_param:
            kwargs["tools"] = tools_param

        logger.info("OpenAI stream_chat: model=%s, messages=%d", model_id, len(messages))
        logger.debug("OpenAI request kwargs: %s", kwargs)

        try:
            stream = await self._client.chat.completions.create(**kwargs)

            # Accumulate tool call deltas
            pending_tool_calls: dict[int, dict[str, Any]] = {}

            async for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                finish_reason = chunk.choices[0].finish_reason if chunk.choices else None

                if delta is None:
                    continue

                # Content tokens
                if delta.content:
                    yield StreamEvent(type="token", content=delta.content)

                # Reasoning summary tokens (if opted in)
                if hasattr(delta, "reasoning") and delta.reasoning:
                    if hasattr(delta.reasoning, "content") and delta.reasoning.content:
                        yield StreamEvent(
                            type="reasoning", content=delta.reasoning.content
                        )

                # Tool call deltas
                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in pending_tool_calls:
                            pending_tool_calls[idx] = {
                                "id": tc_delta.id or "",
                                "name": "",
                                "arguments": "",
                            }
                        if tc_delta.id:
                            pending_tool_calls[idx]["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                pending_tool_calls[idx]["name"] = tc_delta.function.name
                            if tc_delta.function.arguments:
                                pending_tool_calls[idx]["arguments"] += (
                                    tc_delta.function.arguments
                                )

                # Stream complete
                if finish_reason:
                    # Emit any accumulated tool calls
                    for _idx in sorted(pending_tool_calls.keys()):
                        tc_data = pending_tool_calls[_idx]
                        try:
                            args = json.loads(tc_data["arguments"])
                        except json.JSONDecodeError:
                            args = {}
                        yield StreamEvent(
                            type="tool_call",
                            tool_call=ToolCallData(
                                id=tc_data["id"],
                                name=tc_data["name"],
                                arguments=args,
                            ),
                        )

                    # Extract usage metadata from the final chunk
                    metadata: dict[str, Any] = {
                        "finish_reason": finish_reason,
                        "model": model_id,
                        "provider": self.PROVIDER_NAME,
                    }
                    if chunk.usage:
                        metadata["input_tokens"] = chunk.usage.prompt_tokens
                        metadata["output_tokens"] = chunk.usage.completion_tokens

                    yield StreamEvent(type="done", metadata=metadata)

        except Exception as exc:
            logger.exception("OpenAI stream_chat error")
            yield StreamEvent(type="error", error=str(exc))
            raise ProviderError(f"OpenAI streaming failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Non-streaming completion
    # ------------------------------------------------------------------

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict[str, Any] | None = None,
    ) -> CompletionResult:
        """Non-streaming completion (for lightweight model utility calls)."""
        openai_messages = self._to_openai_messages(messages)

        kwargs: dict[str, Any] = {
            "model": model_id,
            "messages": openai_messages,
        }
        if response_format:
            kwargs["response_format"] = response_format

        logger.info("OpenAI complete: model=%s, messages=%d", model_id, len(messages))

        try:
            response = await self._client.chat.completions.create(**kwargs)
            choice = response.choices[0]

            return CompletionResult(
                content=choice.message.content or "",
                model_id=model_id,
                input_tokens=response.usage.prompt_tokens if response.usage else None,
                output_tokens=response.usage.completion_tokens if response.usage else None,
                finish_reason=choice.finish_reason or "",
                raw_response=response.model_dump(),
            )
        except Exception as exc:
            logger.exception("OpenAI complete error")
            raise ProviderError(f"OpenAI completion failed: {exc}") from exc
```

---

### 3.4 `src/backend/providers/anthropic.py`

```python
"""Anthropic provider — direct SDK integration.

Models:
  - claude-opus-4-6-20250130 (Claude Opus 4.6)
  - claude-sonnet-4-6-20250514 (Claude Sonnet 4.6)
  - claude-haiku-4-5-20251001 (Claude Haiku 4.5)

Reasoning: adaptive thinking (recommended) or effort parameter.
Tool calling: native tool_use content blocks.
Streaming: SSE via SDK.

Key Anthropic differences from OpenAI:
  - System message extracted to top-level `system` param (not in messages array)
  - Tool results use content blocks, not a "tool" role
  - Thinking tokens are separate content blocks in the response
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from anthropic import AsyncAnthropic

from src.backend.config import Settings
from src.backend.exceptions import ProviderError, ProviderKeyMissing

from .base import (
    ChatMessage,
    CompletionResult,
    StreamEvent,
    ToolCallData,
    ToolSchema,
)

logger = logging.getLogger(__name__)


class AnthropicProvider:
    """Anthropic LLM provider using the official Python SDK."""

    PROVIDER_NAME = "anthropic"

    def __init__(self, settings: Settings) -> None:
        if not settings.anthropic_api_key:
            raise ProviderKeyMissing("Anthropic API key is not configured")
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    # ------------------------------------------------------------------
    # Message translation
    # ------------------------------------------------------------------

    @staticmethod
    def _to_anthropic_messages(
        messages: list[ChatMessage],
    ) -> tuple[str | None, list[dict[str, Any]]]:
        """Convert internal ChatMessages to Anthropic format.

        Returns (system_prompt, messages_list). The system message is
        extracted and returned separately since Anthropic takes it as a
        top-level parameter.
        """
        system_prompt: str | None = None
        result: list[dict[str, Any]] = []

        for msg in messages:
            if msg.role == "system":
                # Anthropic: system is a top-level param, not in messages
                system_prompt = msg.content
                continue

            if msg.role == "tool_call":
                # Anthropic: assistant message with tool_use content blocks
                content_blocks: list[dict[str, Any]] = []
                if msg.content:
                    content_blocks.append({"type": "text", "text": msg.content})
                for tc in msg.tool_calls or []:
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.name,
                        "input": tc.arguments,
                    })
                result.append({"role": "assistant", "content": content_blocks})

            elif msg.role == "tool_result":
                # Anthropic: tool results are "user" role with tool_result content blocks
                result.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": msg.tool_call_id or "",
                            "content": msg.content or "",
                        }
                    ],
                })

            elif msg.role == "assistant":
                result.append({
                    "role": "assistant",
                    "content": msg.content or "",
                })

            elif msg.role == "user":
                result.append({
                    "role": "user",
                    "content": msg.content or "",
                })

        return system_prompt, result

    @staticmethod
    def _build_tools_param(
        tools: list[ToolSchema] | None,
    ) -> list[dict[str, Any]] | None:
        """Convert tool schemas to Anthropic tool_use format."""
        if not tools:
            return None
        return [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "input_schema": t.get("parameters", {}),
            }
            for t in tools
        ]

    @staticmethod
    def _build_thinking_param(
        reasoning_level: str | None,
    ) -> dict[str, Any] | None:
        """Map Wayne reasoning levels to Anthropic thinking parameters.

        Wayne levels → Anthropic mapping:
          off     → None (no thinking param)
          low     → {"type": "adaptive"}  (let Claude decide, biased light)
          medium  → {"type": "adaptive"}
          high    → {"type": "adaptive"}
          adaptive → {"type": "adaptive"}
        """
        if not reasoning_level or reasoning_level == "off":
            return None
        # Use adaptive thinking for all non-off levels (recommended approach)
        return {"type": "adaptive"}

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[ToolSchema] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Stream a chat completion from Anthropic."""
        system_prompt, anthropic_messages = self._to_anthropic_messages(messages)
        tools_param = self._build_tools_param(tools)
        thinking_param = self._build_thinking_param(reasoning_level)

        kwargs: dict[str, Any] = {
            "model": model_id,
            "messages": anthropic_messages,
            "max_tokens": 8192,
        }

        if system_prompt:
            kwargs["system"] = system_prompt

        if thinking_param:
            kwargs["thinking"] = thinking_param

        if tools_param:
            kwargs["tools"] = tools_param

        logger.info(
            "Anthropic stream_chat: model=%s, messages=%d", model_id, len(messages)
        )
        logger.debug("Anthropic request kwargs: %s", kwargs)

        try:
            # Accumulate tool use blocks
            current_tool_id: str = ""
            current_tool_name: str = ""
            current_tool_input_json: str = ""
            input_tokens: int | None = None
            output_tokens: int | None = None

            async with self._client.messages.stream(**kwargs) as stream:
                async for event in stream:
                    # --- Message start: capture usage ---
                    if event.type == "message_start":
                        if hasattr(event, "message") and event.message.usage:
                            input_tokens = event.message.usage.input_tokens

                    # --- Content block start ---
                    elif event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "tool_use":
                            current_tool_id = block.id
                            current_tool_name = block.name
                            current_tool_input_json = ""

                    # --- Content block delta ---
                    elif event.type == "content_block_delta":
                        delta = event.delta

                        if delta.type == "text_delta":
                            yield StreamEvent(type="token", content=delta.text)

                        elif delta.type == "thinking_delta":
                            yield StreamEvent(type="reasoning", content=delta.thinking)

                        elif delta.type == "input_json_delta":
                            current_tool_input_json += delta.partial_json

                    # --- Content block stop ---
                    elif event.type == "content_block_stop":
                        if current_tool_name:
                            try:
                                args = json.loads(current_tool_input_json)
                            except json.JSONDecodeError:
                                args = {}
                            yield StreamEvent(
                                type="tool_call",
                                tool_call=ToolCallData(
                                    id=current_tool_id,
                                    name=current_tool_name,
                                    arguments=args,
                                ),
                            )
                            current_tool_id = ""
                            current_tool_name = ""
                            current_tool_input_json = ""

                    # --- Message delta (stop reason, output usage) ---
                    elif event.type == "message_delta":
                        if hasattr(event, "usage") and event.usage:
                            output_tokens = event.usage.output_tokens

                    # --- Message stop ---
                    elif event.type == "message_stop":
                        metadata: dict[str, Any] = {
                            "finish_reason": "end_turn",
                            "model": model_id,
                            "provider": self.PROVIDER_NAME,
                        }
                        if input_tokens is not None:
                            metadata["input_tokens"] = input_tokens
                        if output_tokens is not None:
                            metadata["output_tokens"] = output_tokens
                        yield StreamEvent(type="done", metadata=metadata)

        except Exception as exc:
            logger.exception("Anthropic stream_chat error")
            yield StreamEvent(type="error", error=str(exc))
            raise ProviderError(f"Anthropic streaming failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Non-streaming completion
    # ------------------------------------------------------------------

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict[str, Any] | None = None,
    ) -> CompletionResult:
        """Non-streaming completion for Anthropic."""
        system_prompt, anthropic_messages = self._to_anthropic_messages(messages)

        kwargs: dict[str, Any] = {
            "model": model_id,
            "messages": anthropic_messages,
            "max_tokens": 4096,
        }
        if system_prompt:
            kwargs["system"] = system_prompt

        logger.info("Anthropic complete: model=%s, messages=%d", model_id, len(messages))

        try:
            response = await self._client.messages.create(**kwargs)

            # Extract text content from content blocks
            text_parts: list[str] = []
            for block in response.content:
                if block.type == "text":
                    text_parts.append(block.text)

            return CompletionResult(
                content="".join(text_parts),
                model_id=model_id,
                input_tokens=response.usage.input_tokens if response.usage else None,
                output_tokens=response.usage.output_tokens if response.usage else None,
                finish_reason=response.stop_reason or "",
                raw_response=response.model_dump(),
            )
        except Exception as exc:
            logger.exception("Anthropic complete error")
            raise ProviderError(f"Anthropic completion failed: {exc}") from exc
```

---

### 3.5 `src/backend/providers/openrouter.py`

```python
"""OpenRouter provider — REST API via httpx (OpenAI-compatible format).

Primary models:
  - deepseek/deepseek-v3.2 (DeepSeek V3.2, general purpose)
  - deepseek/deepseek-r1 (DeepSeek R1, reasoning with always-on CoT)

DeepSeek R1 reasoning is "baked in" — raw reasoning output appears in the
response and must be parsed from <think>...</think> tags.

OpenRouter also provides access to many other models (Gemini, Qwen, Llama,
Mistral, etc.) via dynamic model list fetching.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

import httpx

from src.backend.config import Settings
from src.backend.exceptions import ProviderError, ProviderKeyMissing

from .base import (
    ChatMessage,
    CompletionResult,
    StreamEvent,
    ToolCallData,
    ToolSchema,
)

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODELS_URL = f"{OPENROUTER_BASE_URL}/models"
OPENROUTER_CHAT_URL = f"{OPENROUTER_BASE_URL}/chat/completions"

# Regex for parsing DeepSeek R1 <think> tags from response content
_THINK_TAG_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL)


class OpenRouterProvider:
    """OpenRouter LLM provider using httpx (OpenAI-compatible REST API)."""

    PROVIDER_NAME = "openrouter"

    # Models known to have always-on reasoning (parsed from <think> tags)
    REASONING_MODELS = frozenset({
        "deepseek/deepseek-r1",
    })

    def __init__(self, settings: Settings) -> None:
        if not settings.openrouter_api_key:
            raise ProviderKeyMissing("OpenRouter API key is not configured")
        self._api_key = settings.openrouter_api_key
        self._http_client = httpx.AsyncClient(
            base_url=OPENROUTER_BASE_URL,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:8000",
                "X-Title": "Wayne Bot",
            },
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    async def close(self) -> None:
        """Close the underlying httpx client."""
        await self._http_client.aclose()

    # ------------------------------------------------------------------
    # Message translation (OpenAI-compatible format)
    # ------------------------------------------------------------------

    @staticmethod
    def _to_openrouter_messages(
        messages: list[ChatMessage],
    ) -> list[dict[str, Any]]:
        """Convert internal ChatMessages to OpenAI-compatible format."""
        result: list[dict[str, Any]] = []
        for msg in messages:
            if msg.role == "tool_call":
                tool_calls_payload = []
                for tc in msg.tool_calls or []:
                    tool_calls_payload.append({
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments),
                        },
                    })
                result.append({
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": tool_calls_payload,
                })
            elif msg.role == "tool_result":
                result.append({
                    "role": "tool",
                    "tool_call_id": msg.tool_call_id or "",
                    "content": msg.content or "",
                })
            else:
                result.append({
                    "role": msg.role,
                    "content": msg.content or "",
                })
        return result

    @staticmethod
    def _build_tools_param(
        tools: list[ToolSchema] | None,
    ) -> list[dict[str, Any]] | None:
        """Convert tool schemas to OpenAI function calling format."""
        if not tools:
            return None
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("parameters", {}),
                },
            }
            for t in tools
        ]

    @staticmethod
    def _parse_reasoning_from_content(content: str) -> tuple[str, str]:
        """Parse <think>...</think> tags from DeepSeek R1 response.

        Returns (reasoning_content, clean_content) where reasoning_content
        is the text inside <think> tags, and clean_content is the response
        with <think> tags removed.
        """
        reasoning_parts: list[str] = []
        for match in _THINK_TAG_RE.finditer(content):
            reasoning_parts.append(match.group(1).strip())
        clean = _THINK_TAG_RE.sub("", content).strip()
        return "\n\n".join(reasoning_parts), clean

    # ------------------------------------------------------------------
    # Dynamic model fetching
    # ------------------------------------------------------------------

    async def fetch_models(self) -> list[dict[str, Any]]:
        """Fetch available models from OpenRouter's model list API.

        Returns a list of model metadata dicts with keys:
        id, name, context_length, pricing, etc.
        """
        try:
            response = await self._http_client.get("/models")
            response.raise_for_status()
            data = response.json()
            return data.get("data", [])
        except httpx.HTTPError as exc:
            logger.exception("OpenRouter fetch_models error")
            raise ProviderError(f"Failed to fetch OpenRouter models: {exc}") from exc

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[ToolSchema] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Stream a chat completion from OpenRouter."""
        openrouter_messages = self._to_openrouter_messages(messages)
        tools_param = self._build_tools_param(tools)

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": openrouter_messages,
            "stream": True,
        }

        if tools_param:
            payload["tools"] = tools_param

        logger.info(
            "OpenRouter stream_chat: model=%s, messages=%d", model_id, len(messages)
        )
        logger.debug("OpenRouter request payload: %s", payload)

        is_reasoning_model = model_id in self.REASONING_MODELS

        try:
            async with self._http_client.stream(
                "POST", "/chat/completions", json=payload
            ) as response:
                response.raise_for_status()

                # Accumulate tool call deltas
                pending_tool_calls: dict[int, dict[str, Any]] = {}
                # For reasoning models, accumulate content to parse <think> tags
                accumulated_content = ""
                in_think_tag = False
                reasoning_buffer = ""

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        # Emit accumulated tool calls
                        for idx in sorted(pending_tool_calls.keys()):
                            tc_data = pending_tool_calls[idx]
                            try:
                                args = json.loads(tc_data["arguments"])
                            except json.JSONDecodeError:
                                args = {}
                            yield StreamEvent(
                                type="tool_call",
                                tool_call=ToolCallData(
                                    id=tc_data["id"],
                                    name=tc_data["name"],
                                    arguments=args,
                                ),
                            )

                        metadata: dict[str, Any] = {
                            "finish_reason": "stop",
                            "model": model_id,
                            "provider": self.PROVIDER_NAME,
                        }
                        yield StreamEvent(type="done", metadata=metadata)
                        break

                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})
                    finish_reason = choices[0].get("finish_reason")

                    # Content tokens
                    content = delta.get("content", "")
                    if content:
                        if is_reasoning_model:
                            # Parse <think> tags incrementally
                            for char in content:
                                accumulated_content += char
                                if accumulated_content.endswith("<think>"):
                                    in_think_tag = True
                                    # Emit any content before the tag (minus "<think>")
                                    pre = accumulated_content[:-7]
                                    if pre:
                                        yield StreamEvent(type="token", content=pre)
                                    accumulated_content = ""
                                elif accumulated_content.endswith("</think>"):
                                    in_think_tag = False
                                    # Emit reasoning (minus "</think>")
                                    reasoning = accumulated_content[:-8]
                                    if reasoning:
                                        yield StreamEvent(
                                            type="reasoning", content=reasoning
                                        )
                                    accumulated_content = ""
                                elif not in_think_tag and len(accumulated_content) > 7:
                                    # Safe to emit characters that can't be part of a tag
                                    safe = accumulated_content[:-7]
                                    yield StreamEvent(type="token", content=safe)
                                    accumulated_content = accumulated_content[-7:]
                                elif in_think_tag and len(accumulated_content) > 8:
                                    safe = accumulated_content[:-8]
                                    yield StreamEvent(type="reasoning", content=safe)
                                    accumulated_content = accumulated_content[-8:]
                        else:
                            yield StreamEvent(type="token", content=content)

                    # Tool call deltas (same as OpenAI format)
                    tool_calls = delta.get("tool_calls", [])
                    for tc_delta in tool_calls:
                        idx = tc_delta.get("index", 0)
                        if idx not in pending_tool_calls:
                            pending_tool_calls[idx] = {
                                "id": tc_delta.get("id", ""),
                                "name": "",
                                "arguments": "",
                            }
                        if tc_delta.get("id"):
                            pending_tool_calls[idx]["id"] = tc_delta["id"]
                        fn = tc_delta.get("function", {})
                        if fn.get("name"):
                            pending_tool_calls[idx]["name"] = fn["name"]
                        if fn.get("arguments"):
                            pending_tool_calls[idx]["arguments"] += fn["arguments"]

                    # If finish_reason present in a non-[DONE] chunk, capture usage
                    if finish_reason:
                        usage = chunk.get("usage", {})
                        if usage:
                            # Will be emitted in the [DONE] handler
                            pass

                # Flush any remaining accumulated content
                if accumulated_content:
                    if in_think_tag:
                        yield StreamEvent(type="reasoning", content=accumulated_content)
                    else:
                        yield StreamEvent(type="token", content=accumulated_content)

        except httpx.HTTPStatusError as exc:
            logger.exception("OpenRouter stream_chat HTTP error")
            yield StreamEvent(type="error", error=str(exc))
            raise ProviderError(
                f"OpenRouter streaming failed: HTTP {exc.response.status_code}"
            ) from exc
        except Exception as exc:
            logger.exception("OpenRouter stream_chat error")
            yield StreamEvent(type="error", error=str(exc))
            raise ProviderError(f"OpenRouter streaming failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Non-streaming completion
    # ------------------------------------------------------------------

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict[str, Any] | None = None,
    ) -> CompletionResult:
        """Non-streaming completion via OpenRouter."""
        openrouter_messages = self._to_openrouter_messages(messages)

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": openrouter_messages,
        }
        if response_format:
            payload["response_format"] = response_format

        logger.info("OpenRouter complete: model=%s, messages=%d", model_id, len(messages))

        try:
            response = await self._http_client.post(
                "/chat/completions", json=payload
            )
            response.raise_for_status()
            data = response.json()

            choice = data["choices"][0]
            content = choice["message"].get("content", "")

            # For reasoning models, separate <think> content
            is_reasoning_model = model_id in self.REASONING_MODELS
            raw_response = data
            if is_reasoning_model and content:
                reasoning, clean = self._parse_reasoning_from_content(content)
                raw_response = {**data, "_parsed_reasoning": reasoning}
                content = clean

            usage = data.get("usage", {})
            return CompletionResult(
                content=content,
                model_id=model_id,
                input_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
                finish_reason=choice.get("finish_reason", ""),
                raw_response=raw_response,
            )
        except httpx.HTTPStatusError as exc:
            logger.exception("OpenRouter complete HTTP error")
            raise ProviderError(
                f"OpenRouter completion failed: HTTP {exc.response.status_code}"
            ) from exc
        except Exception as exc:
            logger.exception("OpenRouter complete error")
            raise ProviderError(f"OpenRouter completion failed: {exc}") from exc
```

---

### 3.6 `src/backend/providers/model_catalog.py`

```python
"""Model catalog — static metadata for known models + dynamic OpenRouter fetching.

All model IDs sourced from docs/llm_models_reference.md (verified 2026-03-02).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ModelInfo:
    """Metadata for a single model."""
    id: str
    name: str
    provider: str
    context_window: int
    supports_tools: bool = True
    supports_reasoning: bool = False
    reasoning_type: str | None = None
    is_default: bool = False


# ---------------------------------------------------------------------------
# Static model definitions
# ---------------------------------------------------------------------------

OPENAI_MODELS: list[ModelInfo] = [
    ModelInfo(
        id="gpt-5.2",
        name="GPT-5.2",
        provider="openai",
        context_window=200_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="effort",  # reasoning.effort parameter
    ),
    ModelInfo(
        id="gpt-5",
        name="GPT-5",
        provider="openai",
        context_window=200_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="effort",
        is_default=True,
    ),
    ModelInfo(
        id="gpt-5-mini",
        name="GPT-5 mini",
        provider="openai",
        context_window=200_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="effort",
    ),
    ModelInfo(
        id="gpt-5-nano",
        name="GPT-5 nano",
        provider="openai",
        context_window=200_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="effort",
    ),
]

ANTHROPIC_MODELS: list[ModelInfo] = [
    ModelInfo(
        id="claude-opus-4-6-20250130",
        name="Claude Opus 4.6",
        provider="anthropic",
        context_window=200_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="thinking",  # adaptive thinking
    ),
    ModelInfo(
        id="claude-sonnet-4-6-20250514",
        name="Claude Sonnet 4.6",
        provider="anthropic",
        context_window=200_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="thinking",
        is_default=True,
    ),
    ModelInfo(
        id="claude-haiku-4-5-20251001",
        name="Claude Haiku 4.5",
        provider="anthropic",
        context_window=200_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="thinking",
    ),
]

# Static entries for primary DeepSeek targets — supplemented by dynamic fetch
OPENROUTER_STATIC_MODELS: list[ModelInfo] = [
    ModelInfo(
        id="deepseek/deepseek-r1",
        name="DeepSeek R1",
        provider="openrouter",
        context_window=128_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="baked_in",  # always-on CoT, parsed from <think> tags
    ),
    ModelInfo(
        id="deepseek/deepseek-v3.2",
        name="DeepSeek V3.2",
        provider="openrouter",
        context_window=128_000,
        supports_tools=True,
        supports_reasoning=False,
        is_default=True,
    ),
]


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

class ModelCatalog:
    """Manages the complete set of available models.

    Static models (OpenAI, Anthropic) are always available.
    OpenRouter models can be refreshed dynamically.
    """

    def __init__(self) -> None:
        self._openai_models: list[ModelInfo] = list(OPENAI_MODELS)
        self._anthropic_models: list[ModelInfo] = list(ANTHROPIC_MODELS)
        self._openrouter_models: list[ModelInfo] = list(OPENROUTER_STATIC_MODELS)

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_all_models(self) -> dict[str, list[ModelInfo]]:
        """Return all models grouped by provider."""
        return {
            "openai": self._openai_models,
            "anthropic": self._anthropic_models,
            "openrouter": self._openrouter_models,
        }

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Look up a model by its ID across all providers."""
        for models in [
            self._openai_models,
            self._anthropic_models,
            self._openrouter_models,
        ]:
            for m in models:
                if m.id == model_id:
                    return m
        return None

    def get_context_window(self, model_id: str) -> int | None:
        """Get the context window size for a model (used by token counter)."""
        model = self.get_model(model_id)
        return model.context_window if model else None

    def supports_tools(self, model_id: str) -> bool:
        """Check if a model supports tool calling."""
        model = self.get_model(model_id)
        return model.supports_tools if model else False

    def get_provider_for_model(self, model_id: str) -> str | None:
        """Determine which provider a model belongs to."""
        model = self.get_model(model_id)
        return model.provider if model else None

    # ------------------------------------------------------------------
    # OpenRouter dynamic refresh
    # ------------------------------------------------------------------

    def update_openrouter_models(
        self, raw_models: list[dict[str, Any]]
    ) -> list[ModelInfo]:
        """Replace OpenRouter models with dynamically fetched data.

        Merges dynamic data with our static DeepSeek entries (preferring
        dynamic data when available, but keeping our known metadata for
        reasoning_type, etc.).

        Args:
            raw_models: List of model dicts from OpenRouter /models API.

        Returns:
            The updated list of OpenRouter ModelInfo entries.
        """
        static_by_id = {m.id: m for m in OPENROUTER_STATIC_MODELS}
        updated: list[ModelInfo] = []

        for raw in raw_models:
            model_id = raw.get("id", "")
            if not model_id:
                continue

            name = raw.get("name", model_id)
            context_length = raw.get("context_length", 128_000)

            # If we have static metadata for this model, use our known values
            if model_id in static_by_id:
                static = static_by_id[model_id]
                updated.append(ModelInfo(
                    id=model_id,
                    name=name,
                    provider="openrouter",
                    context_window=context_length,
                    supports_tools=static.supports_tools,
                    supports_reasoning=static.supports_reasoning,
                    reasoning_type=static.reasoning_type,
                    is_default=static.is_default,
                ))
            else:
                updated.append(ModelInfo(
                    id=model_id,
                    name=name,
                    provider="openrouter",
                    context_window=context_length,
                    supports_tools=True,  # assume yes, degrade gracefully
                    supports_reasoning=False,
                ))

        # If dynamic fetch didn't include our primary targets, keep them
        fetched_ids = {m.id for m in updated}
        for static in OPENROUTER_STATIC_MODELS:
            if static.id not in fetched_ids:
                updated.insert(0, static)

        self._openrouter_models = updated
        logger.info("OpenRouter model catalog updated: %d models", len(updated))
        return updated
```

---

### 3.7 `src/backend/providers/registry.py`

```python
"""Provider registry — maps provider names to initialized provider instances.

The registry is created at application startup from Settings. Providers
whose API keys are missing are registered as unavailable (not instantiated)
so the model list can still show them with a "key missing" status.
"""

from __future__ import annotations

import logging
from typing import Any

from src.backend.config import Settings
from src.backend.exceptions import ProviderError, ProviderKeyMissing

from .anthropic import AnthropicProvider
from .base import LLMProvider
from .model_catalog import ModelCatalog
from .openai import OpenAIProvider
from .openrouter import OpenRouterProvider

logger = logging.getLogger(__name__)


class ProviderRegistry:
    """Central registry of LLM provider instances.

    Usage:
        registry = ProviderRegistry(settings)
        provider = registry.get("openai")
        async for event in provider.stream_chat(messages, "gpt-5"):
            ...
    """

    def __init__(self, settings: Settings) -> None:
        self._providers: dict[str, LLMProvider] = {}
        self._availability: dict[str, bool] = {}
        self._errors: dict[str, str] = {}
        self._settings = settings
        self.catalog = ModelCatalog()

        self._init_provider("openai", OpenAIProvider, settings)
        self._init_provider("anthropic", AnthropicProvider, settings)
        self._init_provider("openrouter", OpenRouterProvider, settings)

    def _init_provider(
        self,
        name: str,
        provider_cls: type,
        settings: Settings,
    ) -> None:
        """Attempt to initialize a provider. Record availability."""
        try:
            self._providers[name] = provider_cls(settings)
            self._availability[name] = True
            logger.info("Provider '%s' initialized successfully", name)
        except ProviderKeyMissing as exc:
            self._availability[name] = False
            self._errors[name] = str(exc)
            logger.warning("Provider '%s' unavailable: %s", name, exc)

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------

    def get(self, provider_name: str) -> LLMProvider:
        """Get an initialized provider by name.

        Raises:
            ProviderKeyMissing: If the provider's API key is not configured.
            ProviderError: If the provider name is unknown.
        """
        if provider_name not in self._availability:
            raise ProviderError(f"Unknown provider: {provider_name}")
        if not self._availability[provider_name]:
            raise ProviderKeyMissing(
                f"Provider '{provider_name}' is not available: "
                f"{self._errors.get(provider_name, 'API key missing')}"
            )
        return self._providers[provider_name]

    def get_openrouter(self) -> OpenRouterProvider:
        """Get the OpenRouter provider (typed, for model fetching)."""
        provider = self.get("openrouter")
        assert isinstance(provider, OpenRouterProvider)
        return provider

    def is_available(self, provider_name: str) -> bool:
        """Check if a provider is available (key configured)."""
        return self._availability.get(provider_name, False)

    def get_availability(self) -> dict[str, bool]:
        """Get availability status for all providers."""
        return dict(self._availability)

    def get_provider_for_model(self, model_id: str) -> LLMProvider:
        """Look up which provider owns a model and return it.

        Raises:
            ProviderError: If the model is not in the catalog.
            ProviderKeyMissing: If the owning provider is unavailable.
        """
        provider_name = self.catalog.get_provider_for_model(model_id)
        if provider_name is None:
            raise ProviderError(f"Model '{model_id}' not found in catalog")
        return self.get(provider_name)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def close(self) -> None:
        """Close all provider clients that need cleanup."""
        for name, provider in self._providers.items():
            if hasattr(provider, "close"):
                try:
                    await provider.close()
                    logger.info("Provider '%s' closed", name)
                except Exception:
                    logger.exception("Error closing provider '%s'", name)
```

---

### 3.8 `src/backend/schemas/models_list.py`

```python
"""Pydantic schemas for the GET /api/models response."""

from __future__ import annotations

from pydantic import BaseModel


class ModelSchema(BaseModel):
    """Schema for a single model entry."""
    id: str
    name: str
    provider: str
    context_window: int
    supports_tools: bool
    supports_reasoning: bool
    reasoning_type: str | None = None
    is_default: bool = False


class ProviderModelsSchema(BaseModel):
    """Schema for a provider's model list + availability status."""
    available: bool
    models: list[ModelSchema]


class ModelsListResponse(BaseModel):
    """Response schema for GET /api/models."""
    providers: dict[str, ProviderModelsSchema]
```

---

### 3.9 `src/backend/routes/models.py`

```python
"""Routes for model listing and OpenRouter model refresh.

GET  /api/models                    → Full model list grouped by provider
GET  /api/models/openrouter/refresh → Refresh OpenRouter models from API
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from src.backend.providers.registry import ProviderRegistry
from src.backend.schemas.models_list import (
    ModelSchema,
    ModelsListResponse,
    ProviderModelsSchema,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/models", tags=["models"])


def get_registry() -> ProviderRegistry:
    """Dependency — overridden in main.py with the actual registry instance."""
    raise NotImplementedError("ProviderRegistry dependency not configured")


@router.get("", response_model=ModelsListResponse)
async def list_models(
    registry: ProviderRegistry = Depends(get_registry),
) -> ModelsListResponse:
    """Return all available models grouped by provider."""
    availability = registry.get_availability()
    all_models = registry.catalog.get_all_models()

    providers: dict[str, ProviderModelsSchema] = {}
    for provider_name, model_list in all_models.items():
        providers[provider_name] = ProviderModelsSchema(
            available=availability.get(provider_name, False),
            models=[
                ModelSchema(
                    id=m.id,
                    name=m.name,
                    provider=m.provider,
                    context_window=m.context_window,
                    supports_tools=m.supports_tools,
                    supports_reasoning=m.supports_reasoning,
                    reasoning_type=m.reasoning_type,
                    is_default=m.is_default,
                )
                for m in model_list
            ],
        )

    return ModelsListResponse(providers=providers)


@router.get("/openrouter/refresh")
async def refresh_openrouter_models(
    registry: ProviderRegistry = Depends(get_registry),
) -> dict:
    """Refresh the OpenRouter model list from the API.

    Returns the updated model list.
    """
    if not registry.is_available("openrouter"):
        raise HTTPException(
            status_code=422,
            detail="OpenRouter API key is not configured",
        )

    try:
        openrouter = registry.get_openrouter()
        raw_models = await openrouter.fetch_models()
        updated = registry.catalog.update_openrouter_models(raw_models)

        return {
            "models": [
                ModelSchema(
                    id=m.id,
                    name=m.name,
                    provider=m.provider,
                    context_window=m.context_window,
                    supports_tools=m.supports_tools,
                    supports_reasoning=m.supports_reasoning,
                    reasoning_type=m.reasoning_type,
                    is_default=m.is_default,
                ).model_dump()
                for m in updated
            ],
        }
    except Exception as exc:
        logger.exception("Failed to refresh OpenRouter models")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch models from OpenRouter: {exc}",
        ) from exc
```

---

## 4. Wiring into `main.py`

After Unit F provides `main.py`, add the following during app lifespan:

```python
# In main.py lifespan (or startup event):
from src.backend.providers.registry import ProviderRegistry
from src.backend.routes import models as models_route

registry = ProviderRegistry(settings)

# Override the dependency
models_route.get_registry = lambda: registry

# Include router
app.include_router(models_route.router)

# On shutdown:
await registry.close()
```

This is documented here for context; the actual `main.py` wiring will be implemented when Unit P is built.

---

## 5. Test Plan

All tests use `respx` for HTTP mocking and `unittest.mock` / `pytest-asyncio` for async test support. No real API calls are made.

### 5.1 Test File Structure

```
tests/
├── conftest.py                       # Shared fixtures (from Unit F)
└── unit/
    └── test_providers/
        ├── __init__.py
        ├── conftest.py               # Provider-specific fixtures
        ├── test_openai.py
        ├── test_anthropic.py
        ├── test_openrouter.py
        ├── test_registry.py
        └── test_model_catalog.py
```

### 5.2 `tests/unit/test_providers/conftest.py`

```python
"""Shared fixtures for provider tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.backend.config import Settings


@pytest.fixture
def mock_settings() -> Settings:
    """Settings with all API keys populated."""
    return Settings(
        openai_api_key="sk-test-openai-key",
        anthropic_api_key="sk-ant-test-key",
        openrouter_api_key="sk-or-test-key",
        database_url="postgresql+asyncpg://test:test@localhost/test",
    )


@pytest.fixture
def mock_settings_no_keys() -> Settings:
    """Settings with no API keys."""
    return Settings(
        openai_api_key="",
        anthropic_api_key="",
        openrouter_api_key="",
        database_url="postgresql+asyncpg://test:test@localhost/test",
    )
```

### 5.3 `tests/unit/test_providers/test_openai.py`

```python
"""Tests for OpenAIProvider.

Tests cover:
1. Message translation (ChatMessage → OpenAI format)
2. stream_chat: normal text response
3. stream_chat: response with reasoning tokens
4. stream_chat: response with tool calls
5. complete: non-streaming completion
6. Error handling: API failure → ProviderError
7. Constructor: missing key → ProviderKeyMissing
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from src.backend.exceptions import ProviderError, ProviderKeyMissing
from src.backend.providers.base import ChatMessage, StreamEvent, ToolCallData
from src.backend.providers.openai import OpenAIProvider


class TestOpenAIMessageTranslation:
    """Test ChatMessage → OpenAI format translation."""

    def test_simple_messages(self):
        messages = [
            ChatMessage(role="system", content="You are Wayne."),
            ChatMessage(role="user", content="Hello"),
            ChatMessage(role="assistant", content="Hi there!"),
        ]
        result = OpenAIProvider._to_openai_messages(messages)
        assert len(result) == 3
        assert result[0] == {"role": "system", "content": "You are Wayne."}
        assert result[1] == {"role": "user", "content": "Hello"}
        assert result[2] == {"role": "assistant", "content": "Hi there!"}

    def test_tool_call_message(self):
        messages = [
            ChatMessage(
                role="tool_call",
                content="",
                tool_calls=[
                    ToolCallData(
                        id="call_123",
                        name="web_search",
                        arguments={"query": "test"},
                    )
                ],
            ),
        ]
        result = OpenAIProvider._to_openai_messages(messages)
        assert result[0]["role"] == "assistant"
        assert len(result[0]["tool_calls"]) == 1
        assert result[0]["tool_calls"][0]["function"]["name"] == "web_search"

    def test_tool_result_message(self):
        messages = [
            ChatMessage(
                role="tool_result",
                content='{"results": []}',
                tool_call_id="call_123",
                tool_name="web_search",
            ),
        ]
        result = OpenAIProvider._to_openai_messages(messages)
        assert result[0]["role"] == "tool"
        assert result[0]["tool_call_id"] == "call_123"


class TestOpenAIStreamChat:
    """Test streaming chat completion."""

    @pytest.mark.asyncio
    async def test_normal_response(self, mock_settings):
        """Normal text response yields token events then done."""
        # Build mock streaming chunks
        mock_chunks = _build_openai_chunks([
            {"content": "Hello"},
            {"content": " world"},
            {"finish_reason": "stop"},
        ])

        with patch("src.backend.providers.openai.AsyncOpenAI") as MockClient:
            mock_client = MockClient.return_value
            mock_client.chat.completions.create = AsyncMock(
                return_value=_async_iter(mock_chunks)
            )

            provider = OpenAIProvider(mock_settings)
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Hi")],
                model_id="gpt-5",
            ):
                events.append(event)

            # Should have: token("Hello"), token(" world"), done
            token_events = [e for e in events if e.type == "token"]
            assert len(token_events) == 2
            assert token_events[0].content == "Hello"
            assert token_events[1].content == " world"

            done_events = [e for e in events if e.type == "done"]
            assert len(done_events) == 1
            assert done_events[0].metadata["finish_reason"] == "stop"

    @pytest.mark.asyncio
    async def test_reasoning_response(self, mock_settings):
        """Response with reasoning tokens yields reasoning events."""
        mock_chunks = _build_openai_chunks([
            {"reasoning": "Let me think..."},
            {"content": "The answer is 42."},
            {"finish_reason": "stop"},
        ])

        with patch("src.backend.providers.openai.AsyncOpenAI") as MockClient:
            mock_client = MockClient.return_value
            mock_client.chat.completions.create = AsyncMock(
                return_value=_async_iter(mock_chunks)
            )

            provider = OpenAIProvider(mock_settings)
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="What is 6*7?")],
                model_id="gpt-5.2",
                reasoning_level="medium",
            ):
                events.append(event)

            reasoning_events = [e for e in events if e.type == "reasoning"]
            assert len(reasoning_events) == 1
            assert reasoning_events[0].content == "Let me think..."

    @pytest.mark.asyncio
    async def test_tool_call_response(self, mock_settings):
        """Response with tool calls yields tool_call events."""
        mock_chunks = _build_openai_chunks([
            {
                "tool_call_delta": {
                    "index": 0,
                    "id": "call_abc",
                    "name": "web_search",
                    "arguments_chunk": '{"query": "test"}',
                }
            },
            {"finish_reason": "tool_calls"},
        ])

        with patch("src.backend.providers.openai.AsyncOpenAI") as MockClient:
            mock_client = MockClient.return_value
            mock_client.chat.completions.create = AsyncMock(
                return_value=_async_iter(mock_chunks)
            )

            provider = OpenAIProvider(mock_settings)
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Search for X")],
                model_id="gpt-5",
                tools=[{"name": "web_search", "description": "Search", "parameters": {}}],
            ):
                events.append(event)

            tool_events = [e for e in events if e.type == "tool_call"]
            assert len(tool_events) == 1
            assert tool_events[0].tool_call.name == "web_search"
            assert tool_events[0].tool_call.id == "call_abc"

    @pytest.mark.asyncio
    async def test_missing_key_raises(self, mock_settings_no_keys):
        """Constructor raises ProviderKeyMissing when key is empty."""
        with pytest.raises(ProviderKeyMissing):
            OpenAIProvider(mock_settings_no_keys)


class TestOpenAIComplete:
    """Test non-streaming completion."""

    @pytest.mark.asyncio
    async def test_basic_completion(self, mock_settings):
        """Non-streaming completion returns CompletionResult."""
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Summary text"
        mock_response.choices[0].finish_reason = "stop"
        mock_response.usage = MagicMock(prompt_tokens=50, completion_tokens=20)
        mock_response.model_dump.return_value = {"id": "test"}

        with patch("src.backend.providers.openai.AsyncOpenAI") as MockClient:
            mock_client = MockClient.return_value
            mock_client.chat.completions.create = AsyncMock(
                return_value=mock_response
            )

            provider = OpenAIProvider(mock_settings)
            result = await provider.complete(
                [ChatMessage(role="user", content="Summarize")],
                model_id="gpt-5-nano",
            )

            assert result.content == "Summary text"
            assert result.input_tokens == 50
            assert result.output_tokens == 20


# ---------------------------------------------------------------------------
# Helpers for building mock OpenAI streaming chunks
# ---------------------------------------------------------------------------

def _build_openai_chunks(deltas: list[dict]) -> list[MagicMock]:
    """Build mock OpenAI streaming chunks from simplified delta specs."""
    chunks = []
    for d in deltas:
        chunk = MagicMock()
        choice = MagicMock()

        # Default: no content, no finish_reason, no tool_calls
        choice.delta.content = d.get("content")
        choice.finish_reason = d.get("finish_reason")
        choice.delta.tool_calls = None

        # Reasoning
        if "reasoning" in d:
            reasoning_mock = MagicMock()
            reasoning_mock.content = d["reasoning"]
            choice.delta.reasoning = reasoning_mock
        else:
            choice.delta.reasoning = None

        # Tool call deltas
        if "tool_call_delta" in d:
            tc = d["tool_call_delta"]
            tc_mock = MagicMock()
            tc_mock.index = tc["index"]
            tc_mock.id = tc.get("id")
            tc_mock.function = MagicMock()
            tc_mock.function.name = tc.get("name")
            tc_mock.function.arguments = tc.get("arguments_chunk", "")
            choice.delta.tool_calls = [tc_mock]

        chunk.choices = [choice]
        chunk.usage = None

        # Add usage to the last chunk (the one with finish_reason)
        if d.get("finish_reason"):
            usage = MagicMock()
            usage.prompt_tokens = 100
            usage.completion_tokens = 50
            chunk.usage = usage

        chunks.append(chunk)
    return chunks


async def _async_iter(items):
    """Create an async iterator from a list (simulates SDK streaming)."""
    for item in items:
        yield item
```

### 5.4 `tests/unit/test_providers/test_anthropic.py`

```python
"""Tests for AnthropicProvider.

Tests cover:
1. Message translation (system extraction, tool_use blocks, tool_result blocks)
2. stream_chat: normal text response
3. stream_chat: response with thinking/reasoning tokens
4. stream_chat: response with tool use
5. complete: non-streaming completion
6. Error handling
7. Constructor: missing key → ProviderKeyMissing
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch, AsyncContextDecorator

import pytest
import pytest_asyncio

from src.backend.exceptions import ProviderError, ProviderKeyMissing
from src.backend.providers.base import ChatMessage, StreamEvent, ToolCallData
from src.backend.providers.anthropic import AnthropicProvider


class TestAnthropicMessageTranslation:
    """Test ChatMessage → Anthropic format translation."""

    def test_system_extracted(self):
        """System message is extracted as separate return value."""
        messages = [
            ChatMessage(role="system", content="You are Wayne."),
            ChatMessage(role="user", content="Hello"),
        ]
        system, result = AnthropicProvider._to_anthropic_messages(messages)
        assert system == "You are Wayne."
        assert len(result) == 1
        assert result[0]["role"] == "user"

    def test_tool_use_blocks(self):
        """tool_call → assistant with tool_use content blocks."""
        messages = [
            ChatMessage(
                role="tool_call",
                content="",
                tool_calls=[
                    ToolCallData(id="tu_123", name="web_search", arguments={"q": "x"})
                ],
            ),
        ]
        _, result = AnthropicProvider._to_anthropic_messages(messages)
        assert result[0]["role"] == "assistant"
        blocks = result[0]["content"]
        assert blocks[0]["type"] == "tool_use"
        assert blocks[0]["name"] == "web_search"

    def test_tool_result_blocks(self):
        """tool_result → user with tool_result content blocks."""
        messages = [
            ChatMessage(
                role="tool_result",
                content="search results here",
                tool_call_id="tu_123",
            ),
        ]
        _, result = AnthropicProvider._to_anthropic_messages(messages)
        assert result[0]["role"] == "user"
        blocks = result[0]["content"]
        assert blocks[0]["type"] == "tool_result"
        assert blocks[0]["tool_use_id"] == "tu_123"


class TestAnthropicThinkingParam:
    """Test reasoning level → thinking parameter mapping."""

    def test_off_returns_none(self):
        assert AnthropicProvider._build_thinking_param("off") is None
        assert AnthropicProvider._build_thinking_param(None) is None

    def test_all_levels_use_adaptive(self):
        for level in ["low", "medium", "high", "adaptive"]:
            result = AnthropicProvider._build_thinking_param(level)
            assert result == {"type": "adaptive"}


class TestAnthropicStreamChat:
    """Test streaming chat completion."""

    @pytest.mark.asyncio
    async def test_normal_response(self, mock_settings):
        """Normal text response yields token events then done."""
        events_sequence = [
            _anthropic_event("message_start", message_usage={"input_tokens": 100}),
            _anthropic_event("content_block_start", block_type="text"),
            _anthropic_event("content_block_delta", delta_type="text_delta", text="Hello world"),
            _anthropic_event("content_block_stop"),
            _anthropic_event("message_delta", output_tokens=25),
            _anthropic_event("message_stop"),
        ]

        with patch("src.backend.providers.anthropic.AsyncAnthropic") as MockClient:
            mock_client = MockClient.return_value
            mock_stream = _build_anthropic_stream(events_sequence)
            mock_client.messages.stream = MagicMock(return_value=mock_stream)

            provider = AnthropicProvider(mock_settings)
            collected = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Hi")],
                model_id="claude-sonnet-4-6-20250514",
            ):
                collected.append(event)

            tokens = [e for e in collected if e.type == "token"]
            assert len(tokens) == 1
            assert tokens[0].content == "Hello world"

            done = [e for e in collected if e.type == "done"]
            assert len(done) == 1
            assert done[0].metadata["provider"] == "anthropic"

    @pytest.mark.asyncio
    async def test_thinking_response(self, mock_settings):
        """Response with thinking blocks yields reasoning events."""
        events_sequence = [
            _anthropic_event("message_start", message_usage={"input_tokens": 100}),
            _anthropic_event("content_block_start", block_type="thinking"),
            _anthropic_event("content_block_delta", delta_type="thinking_delta", thinking="Analyzing..."),
            _anthropic_event("content_block_stop"),
            _anthropic_event("content_block_start", block_type="text"),
            _anthropic_event("content_block_delta", delta_type="text_delta", text="The answer is 42."),
            _anthropic_event("content_block_stop"),
            _anthropic_event("message_delta", output_tokens=30),
            _anthropic_event("message_stop"),
        ]

        with patch("src.backend.providers.anthropic.AsyncAnthropic") as MockClient:
            mock_client = MockClient.return_value
            mock_stream = _build_anthropic_stream(events_sequence)
            mock_client.messages.stream = MagicMock(return_value=mock_stream)

            provider = AnthropicProvider(mock_settings)
            collected = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Think about this")],
                model_id="claude-opus-4-6-20250130",
                reasoning_level="high",
            ):
                collected.append(event)

            reasoning = [e for e in collected if e.type == "reasoning"]
            assert len(reasoning) == 1
            assert "Analyzing" in reasoning[0].content

    @pytest.mark.asyncio
    async def test_tool_use_response(self, mock_settings):
        """Response with tool_use blocks yields tool_call events."""
        events_sequence = [
            _anthropic_event("message_start", message_usage={"input_tokens": 100}),
            _anthropic_event("content_block_start", block_type="tool_use",
                           tool_id="tu_abc", tool_name="web_search"),
            _anthropic_event("content_block_delta", delta_type="input_json_delta",
                           partial_json='{"query": "test"}'),
            _anthropic_event("content_block_stop"),
            _anthropic_event("message_delta", output_tokens=20),
            _anthropic_event("message_stop"),
        ]

        with patch("src.backend.providers.anthropic.AsyncAnthropic") as MockClient:
            mock_client = MockClient.return_value
            mock_stream = _build_anthropic_stream(events_sequence)
            mock_client.messages.stream = MagicMock(return_value=mock_stream)

            provider = AnthropicProvider(mock_settings)
            collected = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Search")],
                model_id="claude-sonnet-4-6-20250514",
                tools=[{"name": "web_search", "description": "Search", "parameters": {}}],
            ):
                collected.append(event)

            tool_events = [e for e in collected if e.type == "tool_call"]
            assert len(tool_events) == 1
            assert tool_events[0].tool_call.name == "web_search"
            assert tool_events[0].tool_call.id == "tu_abc"

    @pytest.mark.asyncio
    async def test_missing_key_raises(self, mock_settings_no_keys):
        with pytest.raises(ProviderKeyMissing):
            AnthropicProvider(mock_settings_no_keys)


class TestAnthropicComplete:
    """Test non-streaming completion."""

    @pytest.mark.asyncio
    async def test_basic_completion(self, mock_settings):
        mock_response = MagicMock()
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "Conversation summary"
        mock_response.content = [text_block]
        mock_response.usage = MagicMock(input_tokens=80, output_tokens=30)
        mock_response.stop_reason = "end_turn"
        mock_response.model_dump.return_value = {"id": "test"}

        with patch("src.backend.providers.anthropic.AsyncAnthropic") as MockClient:
            mock_client = MockClient.return_value
            mock_client.messages.create = AsyncMock(return_value=mock_response)

            provider = AnthropicProvider(mock_settings)
            result = await provider.complete(
                [ChatMessage(role="user", content="Summarize")],
                model_id="claude-haiku-4-5-20251001",
            )

            assert result.content == "Conversation summary"
            assert result.input_tokens == 80


# ---------------------------------------------------------------------------
# Helpers for building mock Anthropic streaming events
# ---------------------------------------------------------------------------

def _anthropic_event(
    event_type: str,
    *,
    block_type: str | None = None,
    delta_type: str | None = None,
    text: str | None = None,
    thinking: str | None = None,
    partial_json: str | None = None,
    tool_id: str | None = None,
    tool_name: str | None = None,
    message_usage: dict | None = None,
    output_tokens: int | None = None,
) -> MagicMock:
    """Build a mock Anthropic streaming event."""
    event = MagicMock()
    event.type = event_type

    if event_type == "message_start":
        event.message = MagicMock()
        if message_usage:
            event.message.usage = MagicMock(input_tokens=message_usage.get("input_tokens", 0))
        else:
            event.message.usage = None

    elif event_type == "content_block_start":
        event.content_block = MagicMock()
        event.content_block.type = block_type or "text"
        if block_type == "tool_use":
            event.content_block.id = tool_id or ""
            event.content_block.name = tool_name or ""

    elif event_type == "content_block_delta":
        event.delta = MagicMock()
        event.delta.type = delta_type or "text_delta"
        if delta_type == "text_delta":
            event.delta.text = text or ""
        elif delta_type == "thinking_delta":
            event.delta.thinking = thinking or ""
        elif delta_type == "input_json_delta":
            event.delta.partial_json = partial_json or ""

    elif event_type == "content_block_stop":
        pass

    elif event_type == "message_delta":
        if output_tokens is not None:
            event.usage = MagicMock(output_tokens=output_tokens)
        else:
            event.usage = None

    elif event_type == "message_stop":
        pass

    return event


class _MockAnthropicStream:
    """Mock async context manager that yields events."""

    def __init__(self, events: list[MagicMock]):
        self._events = events

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def __aiter__(self):
        return self._iter_events()

    async def _iter_events(self):
        for event in self._events:
            yield event


def _build_anthropic_stream(events: list[MagicMock]) -> _MockAnthropicStream:
    return _MockAnthropicStream(events)
```

### 5.5 `tests/unit/test_providers/test_openrouter.py`

```python
"""Tests for OpenRouterProvider.

Tests cover:
1. Message translation (OpenAI-compatible format)
2. stream_chat: normal text response
3. stream_chat: DeepSeek R1 response with <think> tag parsing
4. stream_chat: response with tool calls
5. complete: non-streaming completion
6. complete: DeepSeek R1 reasoning extraction from non-streaming response
7. fetch_models: dynamic model list fetching
8. Error handling
9. Constructor: missing key → ProviderKeyMissing

Uses respx for HTTP mocking since OpenRouter uses httpx (no SDK).
"""

import json

import httpx
import pytest
import respx

from src.backend.exceptions import ProviderError, ProviderKeyMissing
from src.backend.providers.base import ChatMessage, StreamEvent, ToolCallData
from src.backend.providers.openrouter import OpenRouterProvider


class TestOpenRouterMessageTranslation:
    """Test ChatMessage → OpenRouter format (same as OpenAI)."""

    def test_simple_messages(self):
        messages = [
            ChatMessage(role="system", content="System prompt"),
            ChatMessage(role="user", content="Hello"),
        ]
        result = OpenRouterProvider._to_openrouter_messages(messages)
        assert len(result) == 2
        assert result[0]["role"] == "system"
        assert result[1]["role"] == "user"


class TestOpenRouterReasoningParsing:
    """Test <think> tag parsing for DeepSeek R1."""

    def test_parse_reasoning_from_content(self):
        content = "<think>Let me reason about this.</think>The answer is 42."
        reasoning, clean = OpenRouterProvider._parse_reasoning_from_content(content)
        assert reasoning == "Let me reason about this."
        assert clean == "The answer is 42."

    def test_no_reasoning_tags(self):
        content = "Just a normal response."
        reasoning, clean = OpenRouterProvider._parse_reasoning_from_content(content)
        assert reasoning == ""
        assert clean == "Just a normal response."

    def test_multiple_think_tags(self):
        content = "<think>First thought.</think>Some text.<think>Second thought.</think>More text."
        reasoning, clean = OpenRouterProvider._parse_reasoning_from_content(content)
        assert "First thought." in reasoning
        assert "Second thought." in reasoning
        assert clean == "Some text.More text."


class TestOpenRouterStreamChat:
    """Test streaming chat via httpx / respx."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_normal_response(self, mock_settings):
        """Normal non-reasoning model response."""
        sse_data = (
            'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'
            'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n'
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n'
            "data: [DONE]\n\n"
        )

        respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
            return_value=httpx.Response(200, text=sse_data, headers={"content-type": "text/event-stream"})
        )

        provider = OpenRouterProvider(mock_settings)
        events = []
        async for event in provider.stream_chat(
            [ChatMessage(role="user", content="Hi")],
            model_id="deepseek/deepseek-v3.2",
        ):
            events.append(event)

        tokens = [e for e in events if e.type == "token"]
        assert any("Hello" in e.content for e in tokens)
        assert any("world" in e.content for e in tokens)

        done = [e for e in events if e.type == "done"]
        assert len(done) == 1

    @pytest.mark.asyncio
    @respx.mock
    async def test_reasoning_model_response(self, mock_settings):
        """DeepSeek R1 response with <think> tags parsed to reasoning events."""
        sse_data = (
            'data: {"choices":[{"delta":{"content":"<think>Reasoning here.</think>"},"finish_reason":null}]}\n\n'
            'data: {"choices":[{"delta":{"content":"The answer."},"finish_reason":null}]}\n\n'
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
            "data: [DONE]\n\n"
        )

        respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
            return_value=httpx.Response(200, text=sse_data, headers={"content-type": "text/event-stream"})
        )

        provider = OpenRouterProvider(mock_settings)
        events = []
        async for event in provider.stream_chat(
            [ChatMessage(role="user", content="Think about this")],
            model_id="deepseek/deepseek-r1",
        ):
            events.append(event)

        reasoning = [e for e in events if e.type == "reasoning"]
        assert len(reasoning) > 0
        all_reasoning = "".join(e.content for e in reasoning)
        assert "Reasoning here." in all_reasoning

    @pytest.mark.asyncio
    @respx.mock
    async def test_tool_call_response(self, mock_settings):
        """Response with tool calls in OpenAI-compatible format."""
        sse_data = (
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xyz","function":{"name":"web_search","arguments":"{\\"query\\": \\"test\\"}"}}]},"finish_reason":null}]}\n\n'
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'
            "data: [DONE]\n\n"
        )

        respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
            return_value=httpx.Response(200, text=sse_data, headers={"content-type": "text/event-stream"})
        )

        provider = OpenRouterProvider(mock_settings)
        events = []
        async for event in provider.stream_chat(
            [ChatMessage(role="user", content="Search")],
            model_id="deepseek/deepseek-v3.2",
            tools=[{"name": "web_search", "description": "Search", "parameters": {}}],
        ):
            events.append(event)

        tool_events = [e for e in events if e.type == "tool_call"]
        assert len(tool_events) == 1
        assert tool_events[0].tool_call.name == "web_search"

    @pytest.mark.asyncio
    async def test_missing_key_raises(self, mock_settings_no_keys):
        with pytest.raises(ProviderKeyMissing):
            OpenRouterProvider(mock_settings_no_keys)


class TestOpenRouterComplete:
    """Test non-streaming completion."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_basic_completion(self, mock_settings):
        response_json = {
            "choices": [{"message": {"content": "Response text"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10},
        }

        respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
            return_value=httpx.Response(200, json=response_json)
        )

        provider = OpenRouterProvider(mock_settings)
        result = await provider.complete(
            [ChatMessage(role="user", content="Test")],
            model_id="deepseek/deepseek-v3.2",
        )

        assert result.content == "Response text"
        assert result.input_tokens == 20

    @pytest.mark.asyncio
    @respx.mock
    async def test_r1_reasoning_extraction(self, mock_settings):
        """DeepSeek R1 non-streaming: <think> content extracted."""
        response_json = {
            "choices": [
                {
                    "message": {
                        "content": "<think>Internal reasoning.</think>Clean answer."
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 20, "completion_tokens": 15},
        }

        respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
            return_value=httpx.Response(200, json=response_json)
        )

        provider = OpenRouterProvider(mock_settings)
        result = await provider.complete(
            [ChatMessage(role="user", content="Reason")],
            model_id="deepseek/deepseek-r1",
        )

        assert result.content == "Clean answer."
        assert result.raw_response.get("_parsed_reasoning") == "Internal reasoning."


class TestOpenRouterFetchModels:
    """Test dynamic model list fetching."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_fetch_models(self, mock_settings):
        models_response = {
            "data": [
                {"id": "deepseek/deepseek-r1", "name": "DeepSeek R1", "context_length": 128000},
                {"id": "deepseek/deepseek-v3.2", "name": "DeepSeek V3.2", "context_length": 128000},
                {"id": "google/gemini-2.5-pro", "name": "Gemini 2.5 Pro", "context_length": 1000000},
            ]
        }

        respx.get("https://openrouter.ai/api/v1/models").mock(
            return_value=httpx.Response(200, json=models_response)
        )

        provider = OpenRouterProvider(mock_settings)
        models = await provider.fetch_models()

        assert len(models) == 3
        assert models[0]["id"] == "deepseek/deepseek-r1"

    @pytest.mark.asyncio
    @respx.mock
    async def test_fetch_models_http_error(self, mock_settings):
        respx.get("https://openrouter.ai/api/v1/models").mock(
            return_value=httpx.Response(500, text="Server error")
        )

        provider = OpenRouterProvider(mock_settings)
        with pytest.raises(ProviderError):
            await provider.fetch_models()
```

### 5.6 `tests/unit/test_providers/test_registry.py`

```python
"""Tests for ProviderRegistry."""

from unittest.mock import patch, MagicMock

import pytest

from src.backend.exceptions import ProviderError, ProviderKeyMissing
from src.backend.providers.registry import ProviderRegistry


class TestProviderRegistry:

    def test_all_providers_available(self, mock_settings):
        """With all keys set, all providers are available."""
        with patch("src.backend.providers.registry.OpenAIProvider"), \
             patch("src.backend.providers.registry.AnthropicProvider"), \
             patch("src.backend.providers.registry.OpenRouterProvider"):
            registry = ProviderRegistry(mock_settings)
            availability = registry.get_availability()
            assert availability["openai"] is True
            assert availability["anthropic"] is True
            assert availability["openrouter"] is True

    def test_missing_keys_unavailable(self, mock_settings_no_keys):
        """With no keys, providers are unavailable but registry still works."""
        registry = ProviderRegistry(mock_settings_no_keys)
        availability = registry.get_availability()
        assert availability["openai"] is False
        assert availability["anthropic"] is False
        assert availability["openrouter"] is False

    def test_get_unavailable_raises(self, mock_settings_no_keys):
        """Getting an unavailable provider raises ProviderKeyMissing."""
        registry = ProviderRegistry(mock_settings_no_keys)
        with pytest.raises(ProviderKeyMissing):
            registry.get("openai")

    def test_get_unknown_raises(self, mock_settings_no_keys):
        """Getting an unknown provider raises ProviderError."""
        registry = ProviderRegistry(mock_settings_no_keys)
        with pytest.raises(ProviderError):
            registry.get("unknown_provider")
```

### 5.7 `tests/unit/test_providers/test_model_catalog.py`

```python
"""Tests for ModelCatalog."""

import pytest

from src.backend.providers.model_catalog import ModelCatalog


class TestModelCatalog:

    def test_get_all_models_has_all_providers(self):
        catalog = ModelCatalog()
        all_models = catalog.get_all_models()
        assert "openai" in all_models
        assert "anthropic" in all_models
        assert "openrouter" in all_models

    def test_openai_model_ids(self):
        catalog = ModelCatalog()
        openai = catalog.get_all_models()["openai"]
        ids = {m.id for m in openai}
        assert "gpt-5.2" in ids
        assert "gpt-5" in ids
        assert "gpt-5-mini" in ids
        assert "gpt-5-nano" in ids

    def test_anthropic_model_ids(self):
        catalog = ModelCatalog()
        anthropic = catalog.get_all_models()["anthropic"]
        ids = {m.id for m in anthropic}
        assert "claude-opus-4-6-20250130" in ids
        assert "claude-sonnet-4-6-20250514" in ids
        assert "claude-haiku-4-5-20251001" in ids

    def test_openrouter_model_ids(self):
        catalog = ModelCatalog()
        openrouter = catalog.get_all_models()["openrouter"]
        ids = {m.id for m in openrouter}
        assert "deepseek/deepseek-r1" in ids
        assert "deepseek/deepseek-v3.2" in ids

    def test_get_model_by_id(self):
        catalog = ModelCatalog()
        model = catalog.get_model("gpt-5")
        assert model is not None
        assert model.provider == "openai"
        assert model.is_default is True

    def test_get_model_not_found(self):
        catalog = ModelCatalog()
        assert catalog.get_model("nonexistent") is None

    def test_get_context_window(self):
        catalog = ModelCatalog()
        assert catalog.get_context_window("claude-sonnet-4-6-20250514") == 200_000
        assert catalog.get_context_window("deepseek/deepseek-r1") == 128_000

    def test_supports_tools(self):
        catalog = ModelCatalog()
        assert catalog.supports_tools("gpt-5") is True
        assert catalog.supports_tools("nonexistent") is False

    def test_get_provider_for_model(self):
        catalog = ModelCatalog()
        assert catalog.get_provider_for_model("gpt-5") == "openai"
        assert catalog.get_provider_for_model("claude-opus-4-6-20250130") == "anthropic"
        assert catalog.get_provider_for_model("deepseek/deepseek-r1") == "openrouter"
        assert catalog.get_provider_for_model("nope") is None

    def test_update_openrouter_models(self):
        """Dynamic update merges with static entries."""
        catalog = ModelCatalog()
        raw = [
            {"id": "deepseek/deepseek-r1", "name": "DeepSeek R1 (updated)", "context_length": 131072},
            {"id": "google/gemini-2.5-pro", "name": "Gemini 2.5 Pro", "context_length": 1000000},
        ]
        updated = catalog.update_openrouter_models(raw)

        ids = {m.id for m in updated}
        # R1 present from dynamic data
        assert "deepseek/deepseek-r1" in ids
        # V3.2 preserved from static (wasn't in dynamic data)
        assert "deepseek/deepseek-v3.2" in ids
        # New model from dynamic data
        assert "google/gemini-2.5-pro" in ids

        # R1 should keep its reasoning_type from static metadata
        r1 = next(m for m in updated if m.id == "deepseek/deepseek-r1")
        assert r1.supports_reasoning is True
        assert r1.reasoning_type == "baked_in"

    def test_defaults_marked(self):
        """Each provider has exactly one default model."""
        catalog = ModelCatalog()
        for provider, models in catalog.get_all_models().items():
            defaults = [m for m in models if m.is_default]
            assert len(defaults) == 1, f"{provider} should have exactly 1 default"
```

---

## 6. Implementation Checklist

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 1 | Add Poetry dependencies (openai, anthropic, httpx, tiktoken, respx) | `pyproject.toml` | |
| 2 | Create `providers/__init__.py` | `src/backend/providers/__init__.py` | |
| 3 | Create base types and protocol | `src/backend/providers/base.py` | |
| 4 | Implement OpenAI provider | `src/backend/providers/openai.py` | |
| 5 | Implement Anthropic provider | `src/backend/providers/anthropic.py` | |
| 6 | Implement OpenRouter provider | `src/backend/providers/openrouter.py` | |
| 7 | Implement model catalog | `src/backend/providers/model_catalog.py` | |
| 8 | Implement provider registry | `src/backend/providers/registry.py` | |
| 9 | Create models list schema | `src/backend/schemas/models_list.py` | |
| 10 | Create models route | `src/backend/routes/models.py` | |
| 11 | Wire registry + route into main.py | `src/backend/main.py` | |
| 12 | Write provider test conftest | `tests/unit/test_providers/conftest.py` | |
| 13 | Write OpenAI provider tests | `tests/unit/test_providers/test_openai.py` | |
| 14 | Write Anthropic provider tests | `tests/unit/test_providers/test_anthropic.py` | |
| 15 | Write OpenRouter provider tests | `tests/unit/test_providers/test_openrouter.py` | |
| 16 | Write registry tests | `tests/unit/test_providers/test_registry.py` | |
| 17 | Write model catalog tests | `tests/unit/test_providers/test_model_catalog.py` | |
| 18 | Run full test suite, fix issues | All | |
| 19 | Verify `GET /api/models` returns expected shape | Manual / integration | |

---

## 7. Design Notes

### Why Protocol, not ABC

Per master plan §7.3: Pythonic structural subtyping. Provider implementations don't inherit from `LLMProvider` — they just implement the same method signatures. This makes testing easier (any object with matching methods satisfies the protocol) and avoids coupling.

### Message Translation Strategy

Each provider has a static `_to_*_messages()` method that converts the internal `ChatMessage` list to the provider's wire format. This keeps translation logic self-contained within each provider and makes it independently testable.

### OpenRouter Streaming: Incremental `<think>` Tag Parsing

The OpenRouter provider parses `<think>...</think>` tags character-by-character during streaming so that reasoning content can be emitted as `reasoning` events in real-time rather than waiting for the full response. A small buffer (7-8 chars) is maintained to detect tag boundaries without false positives.

### Tool Schema Normalization

Tool schemas enter the provider layer in a canonical format (name, description, parameters). Each provider's `_build_tools_param()` translates this to its specific format:
- **OpenAI / OpenRouter:** `{"type": "function", "function": {...}}`
- **Anthropic:** `{"name": ..., "input_schema": ...}`

### Error Propagation

Provider errors are caught and re-raised as `ProviderError` (from `exceptions.py`, status 502). During streaming, an `error` StreamEvent is yielded before the exception so the WebSocket handler can notify the client.
