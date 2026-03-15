"""Pydantic schemas for tool-related WebSocket events and API payloads."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class ToolCallStartEvent(BaseModel):
    type: Literal["tool_call_start"] = "tool_call_start"
    tool_name: str
    arguments: dict[str, Any]


class ToolStepEvent(BaseModel):
    type: Literal["tool_step"] = "tool_step"
    step_name: str
    step_index: int
    status: str
    data: dict[str, Any]
    duration_ms: int = 0


class ToolTraceSchema(BaseModel):
    """Serialized tool trace for visibility records."""

    steps: list[dict[str, Any]]
