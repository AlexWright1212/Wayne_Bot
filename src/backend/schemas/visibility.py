"""Pydantic response schemas for visibility data."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, computed_field


class VisibilityResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    message_id: uuid.UUID
    request_payload: dict[str, Any]
    response_metadata: dict[str, Any] | None = None
    tokens_openai: int | None = None
    tokens_anthropic: int | None = None
    tokens_openrouter: int | None = None
    output_tokens: int | None = None
    context_window_size: int | None = None
    active_token_count: int | None = None
    reasoning_content: str | None = None
    summary_event: dict[str, Any] | None = None
    tool_trace: dict[str, Any] | None = None
    created_at: datetime


class TokenCountsResponse(BaseModel):
    tokens_openai: int | None = None
    tokens_anthropic: int | None = None
    tokens_openrouter: int | None = None
    output_tokens: int | None = None
    context_window_size: int | None = None
    active_token_count: int | None = None
    active_provider: str | None = None
    model_id: str | None = None
    utilization: float | None = None
