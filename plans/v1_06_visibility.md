# Unit V — Visibility Layer: Implementation Plan (`plans/v1_06_visibility.md`)

## Overview

This plan covers the complete implementation of Wayne v1 Unit V — Visibility Layer. This unit creates the service that captures full transparency data for every assistant response, the REST endpoints for querying that data, and the Pydantic schemas for API serialization. The visibility layer records API payloads, token counts from all three providers, reasoning content, rolling summary events, and tool execution traces.

All spec references are to `spec/v1_spec.md` v1.1. Architecture references are to `plans/v1_master_plan.md`.

**Depends on:** Unit F (database, ORM models, config), Unit S (TokenCounter service)

**Completion criteria:**
1. `VisibilityService.capture()` creates a `visibility_records` row with all fields populated for a given assistant message
2. The active provider's token count is computed synchronously (blocking) and returned immediately; the other two providers' counts are computed asynchronously via background tasks
3. `GET /api/messages/{id}/visibility` returns the full visibility record for a message
4. `GET /api/conversations/{id}/token-counts` returns the latest token counts and context window utilization for a conversation
5. All three token counting paths (OpenAI/tiktoken, Anthropic/count_tokens, OpenRouter/heuristic) populate correctly
6. Background token counts update the visibility record after the response is delivered
7. Integration tests pass: visibility record exists after chat exchange, API endpoints return correct data, async token counts populate

---

## Step 1: Create Pydantic Schemas — `schemas/visibility.py`

**File:** `src/backend/schemas/visibility.py`

These schemas define the API response shapes for visibility endpoints. They cover the full visibility record (per-message) and the conversation-level token counts summary.

```python
"""Pydantic schemas for the visibility layer API responses."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TokenCounts(BaseModel):
    """Token counts from all three providers for a messages array."""

    openai: int | None = Field(None, description="Token count via tiktoken (OpenAI)")
    anthropic: int | None = Field(None, description="Token count via Anthropic count_tokens API")
    openrouter: int | None = Field(None, description="Token count via characters/3.5 heuristic")


class ContextUtilization(BaseModel):
    """Context window utilization for the active model."""

    active_token_count: int = Field(..., description="Token count from the active provider")
    context_window_size: int = Field(..., description="Total context window of the active model")
    utilization_percent: float = Field(
        ..., description="Percentage of context window used (0-100)"
    )
    provider: str = Field(..., description="Which provider's count is the active one")


class SummaryEventData(BaseModel):
    """Data captured when a rolling summary is triggered."""

    triggered_by_message_id: UUID | None = None
    summarized_message_ids: list[UUID] = Field(default_factory=list)
    summary_text: str | None = None
    tokens_before: int | None = None
    tokens_after: int | None = None
    model_used: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ToolTraceStep(BaseModel):
    """A single step in a tool execution trace."""

    name: str
    status: str  # "running", "complete", "error"
    data: dict = Field(default_factory=dict)
    duration_ms: int = 0


class ToolTraceData(BaseModel):
    """Full tool execution trace."""

    tool_name: str
    tool_arguments: dict = Field(default_factory=dict)
    steps: list[ToolTraceStep] = Field(default_factory=list)
    total_duration_ms: int = 0


class VisibilityResponse(BaseModel):
    """Full visibility record for a single assistant message.

    Returned by GET /api/messages/{id}/visibility.
    Maps 1:1 with the visibility_records table.
    """

    id: UUID
    message_id: UUID

    # API payload exposure (spec §6.2)
    request_payload: dict = Field(
        ..., description="Complete messages array + parameters sent to the LLM"
    )
    response_metadata: dict | None = Field(
        None, description="Raw response metadata (finish reason, usage, etc.)"
    )

    # Token tracking (spec §6.2)
    token_counts: TokenCounts
    output_tokens: int | None = Field(None, description="Output tokens from API response")
    context_utilization: ContextUtilization | None = None

    # Chain of thought / reasoning (spec §6.2)
    reasoning_content: str | None = Field(
        None,
        description="Reasoning content: OpenAI summaries, Anthropic thinking, DeepSeek R1 CoT",
    )

    # Rolling summary event (spec §4.6)
    summary_event: SummaryEventData | None = Field(
        None, description="Present only if a rolling summary was triggered for this exchange"
    )

    # Tool execution trace (spec §5.5)
    tool_trace: ToolTraceData | None = Field(
        None, description="Present only if a tool was invoked during this exchange"
    )

    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TokenCountsResponse(BaseModel):
    """Conversation-level token counts summary.

    Returned by GET /api/conversations/{id}/token-counts.
    Provides the latest token counts and context utilization for the conversation.
    """

    conversation_id: UUID
    token_counts: TokenCounts
    context_utilization: ContextUtilization | None = None
    message_count: int = Field(..., description="Number of messages in the conversation")
    last_updated: datetime | None = Field(
        None, description="Timestamp of the most recent visibility record"
    )

    model_config = ConfigDict(from_attributes=True)
```

**Design notes:**
- `TokenCounts` is a nested object rather than flat fields so it can be reused in both response schemas.
- `ContextUtilization` is computed on read from the stored `active_token_count` and `context_window_size` columns.
- `VisibilityResponse` maps closely to the `visibility_records` ORM model but reshapes the flat columns into nested structures for cleaner API consumption.
- `SummaryEventData` and `ToolTraceData` mirror the JSONB stored in `summary_event` and `tool_trace` columns.

---

## Step 2: Create Visibility Service — `services/visibility.py`

**File:** `src/backend/services/visibility.py`

This is the core service. It provides:
1. `capture()` — called by ChatService after every assistant response to create a visibility record
2. `get_by_message_id()` — retrieves a visibility record for the API endpoint
3. `get_conversation_token_counts()` — computes conversation-level token summary

The critical design from the master plan (§7, decision #6): the active provider's token count runs **synchronously** (blocking, needed for rolling summary threshold), while the other two providers' counts run as **async background tasks** (fire-and-forget, non-blocking).

```python
"""Visibility service — captures and queries transparency data for every assistant response."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.models.visibility import VisibilityRecord
from src.backend.models.message import Message
from src.backend.services.token_counter import TokenCounter

if TYPE_CHECKING:
    from src.backend.providers.base import ChatMessage

logger = logging.getLogger(__name__)


class VisibilityService:
    """Captures full transparency data for every assistant response.

    Token counting strategy (spec §4.3, master plan §7 decision #6):
    - The active provider's count is computed synchronously (required for
      rolling summary threshold checks).
    - The other two providers' counts are computed asynchronously as
      background tasks and update the record after the response is delivered.
    """

    def __init__(self, db: AsyncSession, token_counter: TokenCounter) -> None:
        self._db = db
        self._token_counter = token_counter

    async def capture(
        self,
        *,
        message_id: UUID,
        messages: list[ChatMessage],
        model_id: str,
        provider: str,
        request_payload: dict,
        response_metadata: dict | None = None,
        output_tokens: int | None = None,
        reasoning_content: str | None = None,
        summary_event: dict | None = None,
        tool_trace: dict | None = None,
    ) -> VisibilityRecord:
        """Create a visibility record for an assistant message.

        Computes the active provider's token count synchronously, then
        fires background tasks for the other two providers.

        Args:
            message_id: The assistant message this record belongs to.
            messages: The full messages array that was sent to the LLM
                (used for token counting).
            model_id: The model ID used for this response.
            provider: The active provider ("openai", "anthropic", "openrouter").
            request_payload: Complete request sent to the LLM (messages, params, tools).
            response_metadata: Raw response metadata (finish reason, usage, etc.).
            output_tokens: Output token count from the API response.
            reasoning_content: Reasoning/thinking content if available.
            summary_event: Rolling summary event data if a summary was triggered.
            tool_trace: Tool execution trace if a tool was invoked.

        Returns:
            The created VisibilityRecord (with active provider count populated,
            other counts pending background fill).
        """
        # --- Step 1: Compute active provider token count synchronously ---
        active_count = await self._token_counter.count(
            messages=messages,
            provider=provider,
            model_id=model_id,
        )
        context_window = self._token_counter.get_context_window(model_id)

        # Map active count to the correct column
        tokens_openai: int | None = None
        tokens_anthropic: int | None = None
        tokens_openrouter: int | None = None

        if provider == "openai":
            tokens_openai = active_count
        elif provider == "anthropic":
            tokens_anthropic = active_count
        elif provider == "openrouter":
            tokens_openrouter = active_count

        # --- Step 2: Create the visibility record ---
        record = VisibilityRecord(
            message_id=message_id,
            request_payload=request_payload,
            response_metadata=response_metadata,
            tokens_openai=tokens_openai,
            tokens_anthropic=tokens_anthropic,
            tokens_openrouter=tokens_openrouter,
            output_tokens=output_tokens,
            context_window_size=context_window,
            active_token_count=active_count,
            reasoning_content=reasoning_content,
            summary_event=summary_event,
            tool_trace=tool_trace,
        )
        self._db.add(record)
        await self._db.flush()

        # --- Step 3: Fire background tasks for non-active providers ---
        inactive_providers = [p for p in ("openai", "anthropic", "openrouter") if p != provider]
        for inactive_provider in inactive_providers:
            asyncio.create_task(
                self._fill_background_token_count(
                    record_id=record.id,
                    messages=messages,
                    provider=inactive_provider,
                    model_id=model_id,
                ),
                name=f"token_count_{inactive_provider}_{record.id}",
            )

        logger.info(
            "Visibility record created for message %s: active_count=%d, window=%d",
            message_id,
            active_count,
            context_window,
        )
        return record

    async def _fill_background_token_count(
        self,
        *,
        record_id: UUID,
        messages: list[ChatMessage],
        provider: str,
        model_id: str,
    ) -> None:
        """Background task: compute a non-active provider's token count and update the record.

        This runs as a fire-and-forget asyncio task. It gets its own database
        session to avoid conflicts with the main request session.

        Args:
            record_id: The visibility record to update.
            messages: The messages array to count.
            provider: Which provider's counting method to use.
            model_id: The model (used by some counting methods).
        """
        from src.backend.database import async_session_factory

        try:
            count = await self._token_counter.count(
                messages=messages,
                provider=provider,
                model_id=model_id,
            )

            async with async_session_factory() as session:
                record = await session.get(VisibilityRecord, record_id)
                if record is None:
                    logger.warning(
                        "Visibility record %s not found for background token count", record_id
                    )
                    return

                if provider == "openai":
                    record.tokens_openai = count
                elif provider == "anthropic":
                    record.tokens_anthropic = count
                elif provider == "openrouter":
                    record.tokens_openrouter = count

                await session.commit()
                logger.debug(
                    "Background token count updated: record=%s, provider=%s, count=%d",
                    record_id,
                    provider,
                    count,
                )
        except Exception:
            logger.exception(
                "Failed to compute background token count for provider=%s, record=%s",
                provider,
                record_id,
            )

    async def get_by_message_id(self, message_id: UUID) -> VisibilityRecord | None:
        """Retrieve the visibility record for a given message.

        Args:
            message_id: The message to look up.

        Returns:
            The VisibilityRecord, or None if not found.
        """
        stmt = select(VisibilityRecord).where(VisibilityRecord.message_id == message_id)
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_conversation_token_counts(
        self,
        conversation_id: UUID,
        model_id: str | None = None,
    ) -> dict:
        """Compute conversation-level token counts from the most recent visibility record.

        Returns a dict matching TokenCountsResponse fields.

        Args:
            conversation_id: The conversation to summarize.
            model_id: Optional current model ID (for context utilization recalculation).

        Returns:
            Dict with token_counts, context_utilization, message_count, last_updated.
        """
        # Get the most recent visibility record for this conversation
        stmt = (
            select(VisibilityRecord)
            .join(Message, Message.id == VisibilityRecord.message_id)
            .where(Message.conversation_id == conversation_id)
            .order_by(VisibilityRecord.created_at.desc())
            .limit(1)
        )
        result = await self._db.execute(stmt)
        latest_record = result.scalar_one_or_none()

        # Count messages in conversation
        count_stmt = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
        )
        count_result = await self._db.execute(count_stmt)
        message_count = len(count_result.all())

        if latest_record is None:
            return {
                "conversation_id": conversation_id,
                "token_counts": {
                    "openai": None,
                    "anthropic": None,
                    "openrouter": None,
                },
                "context_utilization": None,
                "message_count": message_count,
                "last_updated": None,
            }

        # If a model_id is provided, recalculate context utilization against it
        context_utilization = None
        if latest_record.active_token_count is not None and latest_record.context_window_size:
            utilization_percent = (
                latest_record.active_token_count / latest_record.context_window_size
            ) * 100
            # Determine which provider's count is active from stored data
            active_provider = _infer_active_provider(latest_record)
            context_utilization = {
                "active_token_count": latest_record.active_token_count,
                "context_window_size": latest_record.context_window_size,
                "utilization_percent": round(utilization_percent, 1),
                "provider": active_provider,
            }

        return {
            "conversation_id": conversation_id,
            "token_counts": {
                "openai": latest_record.tokens_openai,
                "anthropic": latest_record.tokens_anthropic,
                "openrouter": latest_record.tokens_openrouter,
            },
            "context_utilization": context_utilization,
            "message_count": message_count,
            "last_updated": latest_record.created_at,
        }


def _infer_active_provider(record: VisibilityRecord) -> str:
    """Infer which provider was active based on which count matches active_token_count.

    Falls back to "unknown" if no match is found (should not happen in practice).
    """
    if record.active_token_count is not None:
        if record.tokens_openai == record.active_token_count:
            return "openai"
        if record.tokens_anthropic == record.active_token_count:
            return "anthropic"
        if record.tokens_openrouter == record.active_token_count:
            return "openrouter"
    return "unknown"
```

**Design notes:**
- `capture()` is the primary entry point, called by ChatService after assembling the full response.
- The active provider count uses `await` (synchronous from the caller's perspective) because it is needed for rolling summary threshold decisions.
- Background tasks use `asyncio.create_task()` with a dedicated session from `async_session_factory()` to avoid session lifecycle conflicts. This is the fire-and-forget pattern described in master plan §7 decision #6.
- `_fill_background_token_count` catches all exceptions to prevent background task failures from propagating.
- `get_conversation_token_counts` pulls from the most recent visibility record rather than recomputing, since counts are captured per-message.

---

## Step 3: Create API Routes — `routes/visibility.py`

**File:** `src/backend/routes/visibility.py`

Two endpoints per the master plan §3.4:
- `GET /api/messages/{id}/visibility` — full visibility record for a message
- `GET /api/conversations/{id}/token-counts` — latest token counts for a conversation

```python
"""Visibility API routes — transparency data for messages and conversations."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.database import get_db
from src.backend.schemas.visibility import (
    ContextUtilization,
    SummaryEventData,
    TokenCounts,
    TokenCountsResponse,
    ToolTraceData,
    VisibilityResponse,
)
from src.backend.services.token_counter import TokenCounter
from src.backend.services.visibility import VisibilityService

router = APIRouter(prefix="/api", tags=["visibility"])


def _get_visibility_service(db: AsyncSession = Depends(get_db)) -> VisibilityService:
    """Dependency: construct a VisibilityService with the request's DB session."""
    token_counter = TokenCounter()
    return VisibilityService(db=db, token_counter=token_counter)


@router.get(
    "/messages/{message_id}/visibility",
    response_model=VisibilityResponse,
    summary="Get visibility data for a message",
    description="Returns the full visibility record for an assistant message, "
    "including API payload, token counts, reasoning content, summary events, "
    "and tool traces.",
)
async def get_message_visibility(
    message_id: UUID,
    service: VisibilityService = Depends(_get_visibility_service),
) -> VisibilityResponse:
    """Retrieve the visibility record associated with an assistant message.

    Raises 404 if no visibility record exists for the given message ID
    (either the message does not exist or it is not an assistant message).
    """
    record = await service.get_by_message_id(message_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No visibility record found for message {message_id}",
        )

    # Build context utilization if data is present
    context_utilization = None
    if record.active_token_count is not None and record.context_window_size:
        utilization_percent = (record.active_token_count / record.context_window_size) * 100
        from src.backend.services.visibility import _infer_active_provider

        context_utilization = ContextUtilization(
            active_token_count=record.active_token_count,
            context_window_size=record.context_window_size,
            utilization_percent=round(utilization_percent, 1),
            provider=_infer_active_provider(record),
        )

    # Parse JSONB fields into typed schemas
    summary_event = None
    if record.summary_event is not None:
        summary_event = SummaryEventData(**record.summary_event)

    tool_trace = None
    if record.tool_trace is not None:
        tool_trace = ToolTraceData(**record.tool_trace)

    return VisibilityResponse(
        id=record.id,
        message_id=record.message_id,
        request_payload=record.request_payload,
        response_metadata=record.response_metadata,
        token_counts=TokenCounts(
            openai=record.tokens_openai,
            anthropic=record.tokens_anthropic,
            openrouter=record.tokens_openrouter,
        ),
        output_tokens=record.output_tokens,
        context_utilization=context_utilization,
        reasoning_content=record.reasoning_content,
        summary_event=summary_event,
        tool_trace=tool_trace,
        created_at=record.created_at,
    )


@router.get(
    "/conversations/{conversation_id}/token-counts",
    response_model=TokenCountsResponse,
    summary="Get token counts for a conversation",
    description="Returns the latest token counts from all three providers and "
    "context window utilization for the active model. Pulls from the most "
    "recent visibility record in the conversation.",
)
async def get_conversation_token_counts(
    conversation_id: UUID,
    service: VisibilityService = Depends(_get_visibility_service),
) -> TokenCountsResponse:
    """Return conversation-level token count summary.

    Returns zeroed counts if the conversation has no visibility records yet
    (e.g., no assistant messages). Does not raise 404 for empty conversations
    because a conversation may exist with only user messages.
    """
    data = await service.get_conversation_token_counts(conversation_id)

    context_utilization = None
    if data["context_utilization"] is not None:
        context_utilization = ContextUtilization(**data["context_utilization"])

    return TokenCountsResponse(
        conversation_id=data["conversation_id"],
        token_counts=TokenCounts(**data["token_counts"]),
        context_utilization=context_utilization,
        message_count=data["message_count"],
        last_updated=data["last_updated"],
    )
```

**Design notes:**
- The route module stays thin — business logic lives in the service.
- `_get_visibility_service` constructs the service per-request with the DB session from `get_db()`.
- The endpoint manually maps ORM model fields to Pydantic schemas rather than relying on `from_attributes` auto-conversion, because the response schema reshapes flat columns into nested structures (`token_counts`, `context_utilization`).
- 404 is returned only for the message-level endpoint; the conversation-level endpoint returns empty/null data for conversations without visibility records.

---

## Step 4: Register Routes in `main.py`

**File:** `src/backend/main.py`

Add the visibility router to the FastAPI app alongside the existing routers.

```python
# In src/backend/main.py, add to the router registration section:

from src.backend.routes.visibility import router as visibility_router

app.include_router(visibility_router)
```

This follows the same pattern as the existing conversation and model routers.

---

## Step 5: Integration with ChatService — Where `capture()` Is Called

**File:** `src/backend/services/chat.py`

The `ChatService.handle_user_message()` method is the central orchestrator (master plan §7 decision #4). After the LLM response is fully streamed and assembled, it calls `VisibilityService.capture()` to record all transparency data.

The following shows the integration points within the existing ChatService flow. This is not the complete ChatService implementation (that belongs to Unit C+), but the specific visibility-related additions.

```python
# In src/backend/services/chat.py — additions for visibility integration

from src.backend.services.visibility import VisibilityService
from src.backend.services.token_counter import TokenCounter


class ChatService:
    """Central chat orchestrator. Coordinates providers, tools, summaries, and visibility."""

    def __init__(self, db: AsyncSession, ...) -> None:
        self._db = db
        # ... existing dependencies ...
        self._visibility = VisibilityService(
            db=db,
            token_counter=TokenCounter(),
        )

    async def handle_user_message(
        self,
        conversation_id: UUID,
        content: str,
        model_id: str,
        provider: str,
        reasoning_level: str | None = None,
        on_stream: Callable[[StreamEvent], Awaitable[None]] | None = None,
    ) -> Message:
        """Process a user message through the full pipeline.

        The visibility capture happens at the END of the pipeline, after:
        1. Context assembly (system prompt + messages + optional summary)
        2. Rolling summary check (Unit S — may compress context)
        3. LLM API call (streaming response)
        4. Tool execution loop (if tools are invoked)
        5. Final response assembly and persistence

        Only then is capture() called with all the accumulated data.
        """
        # ... Steps 1-5 happen here (Units C, S, T) ...

        # --- Build the request payload for visibility ---
        # This is the exact messages array + parameters sent to the LLM.
        request_payload = {
            "messages": [msg.to_dict() for msg in assembled_messages],
            "model": model_id,
            "provider": provider,
            "reasoning_level": reasoning_level,
            "tools": tool_schemas if tool_schemas else None,
            # Include any other parameters sent to the provider
        }

        # --- Build response metadata from the LLM response ---
        response_metadata = {
            "finish_reason": finish_reason,
            "usage": usage_data,  # tokens reported by the API
        }

        # --- Capture summary event if a rolling summary was triggered ---
        summary_event = None
        if summary_was_triggered:
            summary_event = {
                "triggered_by_message_id": str(user_message.id),
                "summarized_message_ids": [str(mid) for mid in summarized_ids],
                "summary_text": summary_text,
                "tokens_before": tokens_before_summary,
                "tokens_after": tokens_after_summary,
                "model_used": settings.lightweight_model,
            }

        # --- Capture tool trace if a tool was invoked ---
        tool_trace = None
        if tool_result is not None:
            tool_trace = {
                "tool_name": tool_call.tool_name,
                "tool_arguments": tool_call.arguments,
                "steps": [
                    {
                        "name": step.name,
                        "status": step.status,
                        "data": step.data,
                        "duration_ms": step.duration_ms,
                    }
                    for step in tool_result.trace
                ],
                "total_duration_ms": sum(s.duration_ms for s in tool_result.trace),
            }

        # --- Create visibility record ---
        visibility_record = await self._visibility.capture(
            message_id=assistant_message.id,
            messages=assembled_messages,
            model_id=model_id,
            provider=provider,
            request_payload=request_payload,
            response_metadata=response_metadata,
            output_tokens=usage_data.get("completion_tokens") if usage_data else None,
            reasoning_content=accumulated_reasoning,
            summary_event=summary_event,
            tool_trace=tool_trace,
        )

        # --- Include visibility info in the stream_done event ---
        if on_stream:
            await on_stream(StreamEvent(
                type="done",
                metadata={
                    "message_id": str(assistant_message.id),
                    "visibility_id": str(visibility_record.id),
                    "token_counts": {
                        "openai": visibility_record.tokens_openai,
                        "anthropic": visibility_record.tokens_anthropic,
                        "openrouter": visibility_record.tokens_openrouter,
                    },
                    "context_utilization": {
                        "active": visibility_record.active_token_count,
                        "window": visibility_record.context_window_size,
                    },
                },
            ))

        return assistant_message
```

**Key integration points:**
1. `VisibilityService` is instantiated as a dependency of `ChatService`.
2. `capture()` is called **after** the full response pipeline completes — this ensures all data (reasoning, summary events, tool traces) is available.
3. The `stream_done` WebSocket event includes the `visibility_id` so the frontend can fetch the full record on demand.
4. The `assembled_messages` list (the exact context sent to the LLM) is passed to `capture()` for token counting. This is the same list used for the API call, ensuring counts match reality.

---

## Step 6: Test Plan — `tests/integration/test_visibility_api.py`

**File:** `tests/integration/test_visibility_api.py`

Integration tests that verify the full visibility pipeline: record creation, API endpoints, and background token count population.

```python
"""Integration tests for the visibility layer.

Tests cover:
- VisibilityService.capture() creates records with correct data
- Background token count population
- GET /api/messages/{id}/visibility returns correct response
- GET /api/conversations/{id}/token-counts returns correct response
- Edge cases: missing records, empty conversations
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.models.conversation import Conversation
from src.backend.models.message import Message
from src.backend.models.visibility import VisibilityRecord
from src.backend.services.token_counter import TokenCounter
from src.backend.services.visibility import VisibilityService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_token_counter() -> MagicMock:
    """A mock TokenCounter that returns predictable values per provider."""
    counter = MagicMock(spec=TokenCounter)

    async def mock_count(*, messages, provider, model_id):
        counts = {
            "openai": 1000,
            "anthropic": 1050,
            "openrouter": 980,
        }
        return counts[provider]

    counter.count = AsyncMock(side_effect=mock_count)
    counter.get_context_window = MagicMock(return_value=200_000)
    return counter


@pytest.fixture
async def sample_conversation(db_session: AsyncSession) -> Conversation:
    """Create a sample conversation in the test database."""
    conversation = Conversation(title="Test Conversation")
    db_session.add(conversation)
    await db_session.flush()
    return conversation


@pytest.fixture
async def sample_assistant_message(
    db_session: AsyncSession, sample_conversation: Conversation
) -> Message:
    """Create a sample assistant message in the test database."""
    message = Message(
        conversation_id=sample_conversation.id,
        role="assistant",
        content="Hello, I can help with that.",
        model_id="gpt-5",
        provider="openai",
        sequence=2,
    )
    db_session.add(message)
    await db_session.flush()
    return message


@pytest.fixture
def sample_messages() -> list:
    """Sample ChatMessage-like objects for token counting."""
    # Using simple objects with the fields TokenCounter needs
    return [
        MagicMock(role="system", content="You are Wayne."),
        MagicMock(role="user", content="Hello"),
        MagicMock(role="assistant", content="Hello, I can help with that."),
    ]


# ---------------------------------------------------------------------------
# VisibilityService.capture() tests
# ---------------------------------------------------------------------------


class TestVisibilityCapture:
    """Tests for VisibilityService.capture()."""

    async def test_capture_creates_record_with_active_count(
        self,
        db_session: AsyncSession,
        mock_token_counter: MagicMock,
        sample_assistant_message: Message,
        sample_messages: list,
    ):
        """capture() should create a visibility record with the active provider's
        token count populated synchronously."""
        service = VisibilityService(db=db_session, token_counter=mock_token_counter)

        record = await service.capture(
            message_id=sample_assistant_message.id,
            messages=sample_messages,
            model_id="gpt-5",
            provider="openai",
            request_payload={"messages": [], "model": "gpt-5"},
            response_metadata={"finish_reason": "stop"},
            output_tokens=42,
        )

        assert record.id is not None
        assert record.message_id == sample_assistant_message.id
        assert record.tokens_openai == 1000  # Active provider, set synchronously
        assert record.active_token_count == 1000
        assert record.context_window_size == 200_000
        assert record.output_tokens == 42
        assert record.request_payload == {"messages": [], "model": "gpt-5"}
        assert record.response_metadata == {"finish_reason": "stop"}

    async def test_capture_with_anthropic_active(
        self,
        db_session: AsyncSession,
        mock_token_counter: MagicMock,
        sample_assistant_message: Message,
        sample_messages: list,
    ):
        """When Anthropic is the active provider, tokens_anthropic is set synchronously."""
        service = VisibilityService(db=db_session, token_counter=mock_token_counter)

        record = await service.capture(
            message_id=sample_assistant_message.id,
            messages=sample_messages,
            model_id="claude-sonnet-4-6-20250514",
            provider="anthropic",
            request_payload={"messages": [], "model": "claude-sonnet-4-6-20250514"},
        )

        assert record.tokens_anthropic == 1050
        assert record.tokens_openai is None  # Will be filled by background task
        assert record.tokens_openrouter is None
        assert record.active_token_count == 1050

    async def test_capture_with_openrouter_active(
        self,
        db_session: AsyncSession,
        mock_token_counter: MagicMock,
        sample_assistant_message: Message,
        sample_messages: list,
    ):
        """When OpenRouter is the active provider, tokens_openrouter is set synchronously."""
        service = VisibilityService(db=db_session, token_counter=mock_token_counter)

        record = await service.capture(
            message_id=sample_assistant_message.id,
            messages=sample_messages,
            model_id="deepseek/deepseek-v3.2",
            provider="openrouter",
            request_payload={"messages": [], "model": "deepseek/deepseek-v3.2"},
        )

        assert record.tokens_openrouter == 980
        assert record.tokens_openai is None
        assert record.tokens_anthropic is None
        assert record.active_token_count == 980

    async def test_capture_stores_reasoning_content(
        self,
        db_session: AsyncSession,
        mock_token_counter: MagicMock,
        sample_assistant_message: Message,
        sample_messages: list,
    ):
        """Reasoning content (CoT) is stored when provided."""
        service = VisibilityService(db=db_session, token_counter=mock_token_counter)

        record = await service.capture(
            message_id=sample_assistant_message.id,
            messages=sample_messages,
            model_id="gpt-5",
            provider="openai",
            request_payload={"messages": []},
            reasoning_content="The user is asking about X, so I should consider Y and Z.",
        )

        assert record.reasoning_content == (
            "The user is asking about X, so I should consider Y and Z."
        )

    async def test_capture_stores_summary_event(
        self,
        db_session: AsyncSession,
        mock_token_counter: MagicMock,
        sample_assistant_message: Message,
        sample_messages: list,
    ):
        """Rolling summary event data is stored when a summary was triggered."""
        summary_data = {
            "triggered_by_message_id": str(uuid4()),
            "summarized_message_ids": [str(uuid4()), str(uuid4())],
            "summary_text": "The conversation covered topics A and B.",
            "tokens_before": 150000,
            "tokens_after": 80000,
            "model_used": "gpt-5-nano",
        }
        service = VisibilityService(db=db_session, token_counter=mock_token_counter)

        record = await service.capture(
            message_id=sample_assistant_message.id,
            messages=sample_messages,
            model_id="gpt-5",
            provider="openai",
            request_payload={"messages": []},
            summary_event=summary_data,
        )

        assert record.summary_event == summary_data
        assert record.summary_event["tokens_before"] == 150000
        assert record.summary_event["model_used"] == "gpt-5-nano"

    async def test_capture_stores_tool_trace(
        self,
        db_session: AsyncSession,
        mock_token_counter: MagicMock,
        sample_assistant_message: Message,
        sample_messages: list,
    ):
        """Tool execution trace is stored when a tool was invoked."""
        trace_data = {
            "tool_name": "web_search",
            "tool_arguments": {"reason": "Need current info", "query": "latest news"},
            "steps": [
                {"name": "query_generation", "status": "complete", "data": {}, "duration_ms": 320},
                {"name": "search_round_1", "status": "complete", "data": {}, "duration_ms": 1200},
                {"name": "filtering", "status": "complete", "data": {}, "duration_ms": 15},
                {"name": "coverage_check", "status": "complete", "data": {}, "duration_ms": 280},
            ],
            "total_duration_ms": 1815,
        }
        service = VisibilityService(db=db_session, token_counter=mock_token_counter)

        record = await service.capture(
            message_id=sample_assistant_message.id,
            messages=sample_messages,
            model_id="gpt-5",
            provider="openai",
            request_payload={"messages": []},
            tool_trace=trace_data,
        )

        assert record.tool_trace == trace_data
        assert record.tool_trace["tool_name"] == "web_search"
        assert len(record.tool_trace["steps"]) == 4


# ---------------------------------------------------------------------------
# Background token count tests
# ---------------------------------------------------------------------------


class TestBackgroundTokenCounts:
    """Tests for async background token count population."""

    async def test_background_tasks_fill_inactive_counts(
        self,
        db_session: AsyncSession,
        mock_token_counter: MagicMock,
        sample_assistant_message: Message,
        sample_messages: list,
    ):
        """After capture() with openai active, background tasks should fill
        anthropic and openrouter counts."""
        # Patch async_session_factory to return our test session
        with patch(
            "src.backend.services.visibility.async_session_factory"
        ) as mock_factory:
            # Create a mock session that updates the record in our test DB
            mock_bg_session = AsyncMock(spec=AsyncSession)

            async def mock_get(model, record_id):
                """Look up the record from the real test session."""
                from sqlalchemy import select

                stmt = select(VisibilityRecord).where(VisibilityRecord.id == record_id)
                result = await db_session.execute(stmt)
                return result.scalar_one_or_none()

            mock_bg_session.get = AsyncMock(side_effect=mock_get)
            mock_bg_session.commit = AsyncMock()

            # Make the context manager return our mock session
            mock_context = AsyncMock()
            mock_context.__aenter__ = AsyncMock(return_value=mock_bg_session)
            mock_context.__aexit__ = AsyncMock(return_value=False)
            mock_factory.return_value = mock_context

            service = VisibilityService(db=db_session, token_counter=mock_token_counter)

            record = await service.capture(
                message_id=sample_assistant_message.id,
                messages=sample_messages,
                model_id="gpt-5",
                provider="openai",
                request_payload={"messages": []},
            )

            # Let background tasks run
            await asyncio.sleep(0.1)

            # Verify the token counter was called for all three providers
            assert mock_token_counter.count.call_count == 3  # 1 sync + 2 background

    async def test_background_task_handles_errors_gracefully(
        self,
        db_session: AsyncSession,
        sample_assistant_message: Message,
        sample_messages: list,
    ):
        """If a background token count fails, it should log the error
        but not crash or affect other operations."""
        counter = MagicMock(spec=TokenCounter)

        call_count = 0

        async def mock_count(*, messages, provider, model_id):
            nonlocal call_count
            call_count += 1
            if provider == "openai":
                return 1000  # Active provider succeeds
            raise RuntimeError("Simulated API failure")

        counter.count = AsyncMock(side_effect=mock_count)
        counter.get_context_window = MagicMock(return_value=200_000)

        service = VisibilityService(db=db_session, token_counter=counter)

        # This should not raise even though background tasks will fail
        record = await service.capture(
            message_id=sample_assistant_message.id,
            messages=sample_messages,
            model_id="gpt-5",
            provider="openai",
            request_payload={"messages": []},
        )

        # Active count is still set correctly
        assert record.tokens_openai == 1000
        assert record.active_token_count == 1000

        # Let background tasks run (and fail)
        await asyncio.sleep(0.1)

        # No exception propagated — test passes if we get here


# ---------------------------------------------------------------------------
# GET /api/messages/{id}/visibility tests
# ---------------------------------------------------------------------------


class TestGetMessageVisibility:
    """Tests for the GET /api/messages/{id}/visibility endpoint."""

    async def test_returns_visibility_record(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_assistant_message: Message,
    ):
        """Endpoint returns the full visibility record for a message."""
        # Create a visibility record directly in the DB
        record = VisibilityRecord(
            message_id=sample_assistant_message.id,
            request_payload={"messages": [{"role": "user", "content": "Hello"}], "model": "gpt-5"},
            response_metadata={"finish_reason": "stop", "usage": {"total_tokens": 150}},
            tokens_openai=1000,
            tokens_anthropic=1050,
            tokens_openrouter=980,
            output_tokens=42,
            context_window_size=200_000,
            active_token_count=1000,
            reasoning_content="I considered multiple approaches.",
        )
        db_session.add(record)
        await db_session.flush()
        await db_session.commit()

        response = await client.get(
            f"/api/messages/{sample_assistant_message.id}/visibility"
        )

        assert response.status_code == 200
        data = response.json()

        assert data["message_id"] == str(sample_assistant_message.id)
        assert data["token_counts"]["openai"] == 1000
        assert data["token_counts"]["anthropic"] == 1050
        assert data["token_counts"]["openrouter"] == 980
        assert data["output_tokens"] == 42
        assert data["context_utilization"]["active_token_count"] == 1000
        assert data["context_utilization"]["context_window_size"] == 200_000
        assert data["context_utilization"]["utilization_percent"] == 0.5
        assert data["context_utilization"]["provider"] == "openai"
        assert data["reasoning_content"] == "I considered multiple approaches."
        assert data["request_payload"]["model"] == "gpt-5"

    async def test_returns_404_for_missing_record(self, client: AsyncClient):
        """Endpoint returns 404 when no visibility record exists for the message."""
        fake_id = uuid4()
        response = await client.get(f"/api/messages/{fake_id}/visibility")
        assert response.status_code == 404

    async def test_returns_record_with_summary_event(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_assistant_message: Message,
    ):
        """Endpoint correctly deserializes summary_event JSONB data."""
        summary_data = {
            "triggered_by_message_id": str(uuid4()),
            "summarized_message_ids": [str(uuid4())],
            "summary_text": "Summary of earlier messages.",
            "tokens_before": 160000,
            "tokens_after": 75000,
            "model_used": "gpt-5-nano",
        }
        record = VisibilityRecord(
            message_id=sample_assistant_message.id,
            request_payload={"messages": []},
            tokens_openai=1000,
            active_token_count=1000,
            context_window_size=200_000,
            summary_event=summary_data,
        )
        db_session.add(record)
        await db_session.flush()
        await db_session.commit()

        response = await client.get(
            f"/api/messages/{sample_assistant_message.id}/visibility"
        )

        assert response.status_code == 200
        data = response.json()
        assert data["summary_event"] is not None
        assert data["summary_event"]["tokens_before"] == 160000
        assert data["summary_event"]["model_used"] == "gpt-5-nano"

    async def test_returns_record_with_tool_trace(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_assistant_message: Message,
    ):
        """Endpoint correctly deserializes tool_trace JSONB data."""
        trace_data = {
            "tool_name": "web_search",
            "tool_arguments": {"reason": "Need info", "query": "test"},
            "steps": [
                {"name": "query_gen", "status": "complete", "data": {}, "duration_ms": 200},
            ],
            "total_duration_ms": 200,
        }
        record = VisibilityRecord(
            message_id=sample_assistant_message.id,
            request_payload={"messages": []},
            tokens_openai=1000,
            active_token_count=1000,
            context_window_size=200_000,
            tool_trace=trace_data,
        )
        db_session.add(record)
        await db_session.flush()
        await db_session.commit()

        response = await client.get(
            f"/api/messages/{sample_assistant_message.id}/visibility"
        )

        assert response.status_code == 200
        data = response.json()
        assert data["tool_trace"] is not None
        assert data["tool_trace"]["tool_name"] == "web_search"
        assert len(data["tool_trace"]["steps"]) == 1

    async def test_returns_record_with_null_optional_fields(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_assistant_message: Message,
    ):
        """Endpoint handles records where optional fields are null."""
        record = VisibilityRecord(
            message_id=sample_assistant_message.id,
            request_payload={"messages": []},
            tokens_openai=1000,
            active_token_count=1000,
            context_window_size=200_000,
        )
        db_session.add(record)
        await db_session.flush()
        await db_session.commit()

        response = await client.get(
            f"/api/messages/{sample_assistant_message.id}/visibility"
        )

        assert response.status_code == 200
        data = response.json()
        assert data["reasoning_content"] is None
        assert data["summary_event"] is None
        assert data["tool_trace"] is None
        assert data["response_metadata"] is None
        assert data["output_tokens"] is None


# ---------------------------------------------------------------------------
# GET /api/conversations/{id}/token-counts tests
# ---------------------------------------------------------------------------


class TestGetConversationTokenCounts:
    """Tests for the GET /api/conversations/{id}/token-counts endpoint."""

    async def test_returns_counts_from_latest_record(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_conversation: Conversation,
    ):
        """Endpoint returns token counts from the most recent visibility record."""
        # Create two messages with visibility records
        msg1 = Message(
            conversation_id=sample_conversation.id,
            role="assistant",
            content="First response",
            model_id="gpt-5",
            provider="openai",
            sequence=2,
        )
        db_session.add(msg1)
        await db_session.flush()

        record1 = VisibilityRecord(
            message_id=msg1.id,
            request_payload={"messages": []},
            tokens_openai=500,
            tokens_anthropic=520,
            tokens_openrouter=490,
            active_token_count=500,
            context_window_size=200_000,
        )
        db_session.add(record1)

        msg2 = Message(
            conversation_id=sample_conversation.id,
            role="assistant",
            content="Second response",
            model_id="gpt-5",
            provider="openai",
            sequence=4,
        )
        db_session.add(msg2)
        await db_session.flush()

        record2 = VisibilityRecord(
            message_id=msg2.id,
            request_payload={"messages": []},
            tokens_openai=1000,
            tokens_anthropic=1050,
            tokens_openrouter=980,
            active_token_count=1000,
            context_window_size=200_000,
        )
        db_session.add(record2)
        await db_session.flush()
        await db_session.commit()

        response = await client.get(
            f"/api/conversations/{sample_conversation.id}/token-counts"
        )

        assert response.status_code == 200
        data = response.json()

        # Should return the latest record's counts (record2)
        assert data["token_counts"]["openai"] == 1000
        assert data["token_counts"]["anthropic"] == 1050
        assert data["token_counts"]["openrouter"] == 980
        assert data["context_utilization"]["active_token_count"] == 1000
        assert data["context_utilization"]["utilization_percent"] == 0.5

    async def test_returns_empty_for_conversation_without_visibility(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_conversation: Conversation,
    ):
        """Endpoint returns null counts for a conversation with no visibility records."""
        response = await client.get(
            f"/api/conversations/{sample_conversation.id}/token-counts"
        )

        assert response.status_code == 200
        data = response.json()
        assert data["token_counts"]["openai"] is None
        assert data["token_counts"]["anthropic"] is None
        assert data["token_counts"]["openrouter"] is None
        assert data["context_utilization"] is None
        assert data["message_count"] == 0

    async def test_message_count_reflects_all_roles(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        sample_conversation: Conversation,
    ):
        """Message count includes all messages in the conversation, not just assistant."""
        for i, role in enumerate(["user", "assistant", "user", "assistant"]):
            msg = Message(
                conversation_id=sample_conversation.id,
                role=role,
                content=f"Message {i}",
                sequence=i + 1,
                model_id="gpt-5" if role == "assistant" else None,
                provider="openai" if role == "assistant" else None,
            )
            db_session.add(msg)
        await db_session.flush()
        await db_session.commit()

        response = await client.get(
            f"/api/conversations/{sample_conversation.id}/token-counts"
        )

        assert response.status_code == 200
        data = response.json()
        assert data["message_count"] == 4
```

**Test coverage summary:**

| Area | Tests | What is verified |
|---|---|---|
| `capture()` — active provider | 3 tests (one per provider) | Correct column populated synchronously; others null |
| `capture()` — optional fields | 3 tests | Reasoning, summary event, tool trace stored correctly |
| Background token counts | 2 tests | Inactive providers filled async; errors handled gracefully |
| `GET /messages/{id}/visibility` | 5 tests | Full record, 404, summary event, tool trace, null fields |
| `GET /conversations/{id}/token-counts` | 3 tests | Latest record, empty conversation, message count |
| **Total** | **16 tests** | |

---

## File Summary

| File | Purpose |
|---|---|
| `src/backend/schemas/visibility.py` | Pydantic response models: `VisibilityResponse`, `TokenCountsResponse`, and nested schemas |
| `src/backend/services/visibility.py` | `VisibilityService` with `capture()`, `get_by_message_id()`, `get_conversation_token_counts()` |
| `src/backend/routes/visibility.py` | FastAPI router: `GET /api/messages/{id}/visibility`, `GET /api/conversations/{id}/token-counts` |
| `src/backend/main.py` | Router registration (one line addition) |
| `src/backend/services/chat.py` | Integration point: `capture()` called after full response pipeline |
| `tests/integration/test_visibility_api.py` | 16 integration tests covering service, endpoints, and background tasks |

---

## Implementation Order

1. **schemas/visibility.py** — Define all response shapes first (no dependencies)
2. **services/visibility.py** — Core logic (depends on TokenCounter from Unit S, ORM model from Unit F)
3. **routes/visibility.py** — Thin API layer (depends on service + schemas)
4. **main.py** — Register router (one line)
5. **tests/integration/test_visibility_api.py** — Verify everything works together
6. **services/chat.py** — Wire `capture()` into the chat orchestrator (done in Phase 6 / Unit C+)

Steps 1-5 can be completed within Unit V. Step 6 happens during the Phase 6 integration (Unit C+) when all subsystems are wired together into the chat orchestrator.
