"""Provider abstraction layer — base types and protocol.

Defines the shared types (ChatMessage, StreamEvent, etc.) that flow through
the entire system, plus the LLMProvider protocol that all providers implement.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal, Protocol, runtime_checkable


@dataclass
class ToolCallData:
    """A single tool call from an LLM response."""

    id: str
    name: str
    arguments: str  # Raw JSON string, not parsed dict


@dataclass
class ToolSchema:
    """Tool definition for registration with the tool framework.

    Note: Providers do NOT consume ToolSchema objects directly. The
    ToolFramework translates these into provider-specific dicts via
    get_schemas_for_provider(), which are then passed to stream_chat().
    """

    name: str
    description: str
    parameters: dict  # JSON Schema


@dataclass
class CompletionResult:
    """Result from a non-streaming LLM call."""

    content: str
    tool_calls: list[ToolCallData] | None = None
    metadata: dict = field(default_factory=dict)


@dataclass
class ChatMessage:
    """A message in a conversation, provider-agnostic."""

    role: Literal["user", "assistant", "system", "tool_call", "tool_result"]
    content: str | None = None
    tool_calls: list[ToolCallData] | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None


@dataclass
class StreamEvent:
    """A single event from a streaming LLM response.

    Provider-emitted types: token, tool_call, reasoning, done, error.
    Chat-service internal types: summary_started, summary_complete, tool_call_start,
        tool_step, _tool_task_ref (intercepted by WS handler, never forwarded to client).
    """

    type: Literal[
        "token", "tool_call", "reasoning", "done", "error",
        "summary_started", "summary_complete", "tool_call_start",
        "tool_step", "_tool_task_ref",
    ]
    content: str = ""
    tool_call: ToolCallData | None = None
    metadata: dict | None = None
    error: str | None = None


@runtime_checkable
class LLMProvider(Protocol):
    """Protocol that all LLM providers must satisfy."""

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[StreamEvent]: ...

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict | None = None,
    ) -> CompletionResult: ...


# Valid reasoning levels per provider
REASONING_LEVELS: dict[str, list[str]] = {
    "openai": ["none", "low", "medium", "high", "xhigh"],
    "anthropic": ["off", "low", "medium", "high", "adaptive"],
    "openrouter": [],  # Reasoning is model-dependent, not user-controlled
}
