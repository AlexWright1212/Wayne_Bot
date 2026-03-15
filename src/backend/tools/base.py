"""Core tool abstractions: Tool ABC, ToolStep, ToolResult, ToolContext."""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class ToolStep:
    name: str
    status: Literal["running", "complete", "error"]
    data: dict
    duration_ms: int = 0


@dataclass
class ToolResult:
    content: str | dict
    trace: list[ToolStep] = field(default_factory=list)


@dataclass
class ToolContext:
    user_message: str
    conversation_id: uuid.UUID
    lightweight_complete: Callable  # async (messages, response_format=None) -> CompletionResult


class Tool(ABC):
    name: str
    description: str
    parameters: dict  # JSON Schema

    @abstractmethod
    async def execute(
        self,
        arguments: dict,
        context: ToolContext,
        on_step: Callable[[ToolStep], Awaitable[None]],
    ) -> ToolResult: ...
