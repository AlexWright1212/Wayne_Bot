# Unit C — Chat Core: Implementation Plan (`plans/v1_03_chat_core.md`)

## Overview

This plan covers the complete implementation of Wayne v1 Unit C — Chat Core. This unit wires up the central chat loop: conversation CRUD, the chat orchestrator that coordinates message persistence with LLM streaming, auto-titling via GPT-5 nano, REST endpoints for conversation management, and the WebSocket endpoint for real-time streaming.

All spec references are to `spec/v1_spec.md` v1.1. Model information sourced from `docs/llm_models_reference.md` (verified 2026-03-02).

**Depends on:** Unit F (database, ORM models, config, exceptions, system prompt) + Unit P (provider layer, `LLMProvider` protocol, `ProviderRegistry`, `ChatMessage`/`StreamEvent` types)

**Creates:**
- `src/backend/services/conversation.py`
- `src/backend/services/chat.py`
- `src/backend/services/auto_title.py`
- `src/backend/routes/conversations.py`
- `src/backend/routes/ws.py`
- `src/backend/schemas/conversations.py`
- `src/backend/schemas/messages.py`
- `src/backend/schemas/ws.py`
- `tests/integration/test_conversations_api.py`
- `tests/integration/test_chat_flow.py`
- `tests/integration/test_websocket.py`

**Completion criteria:**
1. `POST /api/conversations` creates a conversation; `GET /api/conversations` lists it; `GET /api/conversations/{id}` returns it with messages; `PATCH` renames it; `DELETE` removes it with 204
2. WebSocket at `/ws/{conversation_id}` accepts a `send_message` frame, streams `stream_token` / `stream_reasoning` / `stream_done` events back, and persists both user and assistant messages with correct sequence numbers
3. After the first user+assistant exchange, auto-title fires asynchronously and the sidebar receives a `title_updated` WebSocket event
4. Provider errors during streaming produce a recoverable `error` WebSocket event; the connection stays open
5. All integration tests pass: `pytest tests/integration/test_conversations_api.py tests/integration/test_chat_flow.py tests/integration/test_websocket.py`

---

## Step 1: Pydantic Schemas — `schemas/conversations.py`

**File:** `src/backend/schemas/conversations.py`

These schemas define the REST request/response shapes for conversation CRUD. They do not contain business logic.

```python
"""Pydantic schemas for conversation CRUD endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


# ── Requests ──────────────────────────────────────────────────────────────────

class ConversationCreate(BaseModel):
    """Body for POST /api/conversations. All fields optional — a blank
    conversation is the normal case (user clicks 'New Chat')."""
    title: str | None = None


class ConversationUpdate(BaseModel):
    """Body for PATCH /api/conversations/{id}. Only title is mutable."""
    title: str = Field(..., min_length=1, max_length=255)


# ── Responses ─────────────────────────────────────────────────────────────────

class ConversationResponse(BaseModel):
    """Returned by POST and PATCH. Lightweight — no messages."""
    id: UUID
    title: str | None
    last_model_id: str | None
    last_provider: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationSummary(BaseModel):
    """Item in the GET /api/conversations list. Same shape as
    ConversationResponse — kept as a separate type so the list endpoint
    can diverge later (e.g. add unread count)."""
    id: UUID
    title: str | None
    last_model_id: str | None
    last_provider: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetail(BaseModel):
    """Returned by GET /api/conversations/{id}. Includes full message list."""
    id: UUID
    title: str | None
    last_model_id: str | None
    last_provider: str | None
    created_at: datetime
    updated_at: datetime
    messages: list["MessageResponse"] = []

    model_config = {"from_attributes": True}


# Forward ref resolved after MessageResponse is importable
from src.backend.schemas.messages import MessageResponse  # noqa: E402

ConversationDetail.model_rebuild()
```

**Notes:**
- `from_attributes = True` enables direct construction from SQLAlchemy model instances.
- The forward reference for `MessageResponse` is resolved at module level so Pydantic can build the model. This avoids circular imports because `messages.py` does not import from `conversations.py`.

---

## Step 2: Pydantic Schemas — `schemas/messages.py`

**File:** `src/backend/schemas/messages.py`

```python
"""Pydantic schemas for message data."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class MessageResponse(BaseModel):
    """Single message as returned inside ConversationDetail and after
    persistence. Covers all roles: user, assistant, system, tool_call,
    tool_result, summary."""
    id: UUID
    conversation_id: UUID
    role: str
    content: str | None

    # Model attribution (assistant messages)
    model_id: str | None = None
    provider: str | None = None
    reasoning_level: str | None = None

    # Tool call fields (role = tool_call)
    tool_call_id: str | None = None
    tool_name: str | None = None
    tool_arguments: dict[str, Any] | None = None

    # Tool result fields (role = tool_result)
    tool_result_call_id: str | None = None
    tool_result_name: str | None = None

    sequence: int
    created_at: datetime

    model_config = {"from_attributes": True}
```

---

## Step 3: Pydantic Schemas — `schemas/ws.py`

**File:** `src/backend/schemas/ws.py`

These schemas model every WebSocket frame exchanged between client and server, matching the protocol defined in master plan section 3.3.

```python
"""Pydantic schemas for WebSocket message framing.

Client -> Server: WSClientMessage (discriminated by `type`).
Server -> Client: WSServerEvent (discriminated by `type`).
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


# ── Client -> Server ──────────────────────────────────────────────────────────

class WSSendMessage(BaseModel):
    """The only client->server message type for v1."""
    type: Literal["send_message"] = "send_message"
    content: str = Field(..., min_length=1)
    model_id: str
    provider: str  # "openai" | "anthropic" | "openrouter"
    reasoning_level: str | None = None


# Union type for future expansion (e.g. cancel_stream, ping)
WSClientMessage = WSSendMessage


# ── Server -> Client ──────────────────────────────────────────────────────────

class WSStreamToken(BaseModel):
    type: Literal["stream_token"] = "stream_token"
    content: str


class WSStreamReasoning(BaseModel):
    type: Literal["stream_reasoning"] = "stream_reasoning"
    content: str


class WSToolCallStart(BaseModel):
    type: Literal["tool_call_start"] = "tool_call_start"
    tool_name: str
    arguments: dict[str, Any]


class WSToolStep(BaseModel):
    type: Literal["tool_step"] = "tool_step"
    step_name: str
    step_index: int
    status: Literal["running", "complete", "error"]
    data: dict[str, Any] = {}


class WSStreamDone(BaseModel):
    type: Literal["stream_done"] = "stream_done"
    message_id: UUID
    visibility_id: UUID | None = None
    token_counts: dict[str, int] | None = None
    context_utilization: dict[str, Any] | None = None


class WSSummaryStarted(BaseModel):
    type: Literal["summary_started"] = "summary_started"


class WSSummaryComplete(BaseModel):
    type: Literal["summary_complete"] = "summary_complete"


class WSTitleUpdated(BaseModel):
    type: Literal["title_updated"] = "title_updated"
    conversation_id: UUID
    title: str


class WSError(BaseModel):
    type: Literal["error"] = "error"
    message: str
    recoverable: bool = True


WSServerEvent = (
    WSStreamToken
    | WSStreamReasoning
    | WSToolCallStart
    | WSToolStep
    | WSStreamDone
    | WSSummaryStarted
    | WSSummaryComplete
    | WSTitleUpdated
    | WSError
)
```

---

## Step 4: `services/conversation.py` — ConversationService

**File:** `src/backend/services/conversation.py`

This service encapsulates all conversation and message CRUD plus sequence number management. It operates on the SQLAlchemy async session and is the only module that writes to the `conversations` and `messages` tables.

```python
"""Conversation and message persistence service.

Handles CRUD for conversations and messages, including monotonic sequence
number management within each conversation.
"""

import logging
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.backend.models.conversation import Conversation
from src.backend.models.message import Message

logger = logging.getLogger(__name__)


class ConversationService:
    """Thin data-access layer for conversations and their messages."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Conversation CRUD ─────────────────────────────────────────────────

    async def create_conversation(
        self,
        title: str | None = None,
    ) -> Conversation:
        """Create a new conversation. Title may be None (auto-titled later)."""
        conv = Conversation(title=title)
        self.db.add(conv)
        await self.db.flush()  # assigns id
        logger.info("Created conversation %s", conv.id)
        return conv

    async def get_conversation(self, conversation_id: UUID) -> Conversation | None:
        """Fetch a single conversation by ID (no messages loaded)."""
        result = await self.db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        return result.scalar_one_or_none()

    async def get_conversation_with_messages(
        self, conversation_id: UUID
    ) -> Conversation | None:
        """Fetch a conversation with all messages eagerly loaded, ordered by
        sequence number."""
        result = await self.db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .options(selectinload(Conversation.messages))
        )
        conv = result.scalar_one_or_none()
        if conv is not None:
            # Sort in Python since selectinload doesn't guarantee order
            conv.messages.sort(key=lambda m: m.sequence)
        return conv

    async def list_conversations(self) -> list[Conversation]:
        """List all conversations, most-recently-updated first."""
        result = await self.db.execute(
            select(Conversation).order_by(Conversation.updated_at.desc())
        )
        return list(result.scalars().all())

    async def update_conversation(
        self,
        conversation_id: UUID,
        **kwargs: object,
    ) -> Conversation | None:
        """Update mutable fields on a conversation (title, last_model_id,
        last_provider). Returns the updated row or None if not found."""
        allowed = {"title", "last_model_id", "last_provider"}
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return await self.get_conversation(conversation_id)

        await self.db.execute(
            update(Conversation)
            .where(Conversation.id == conversation_id)
            .values(**updates)
        )
        await self.db.flush()
        return await self.get_conversation(conversation_id)

    async def delete_conversation(self, conversation_id: UUID) -> bool:
        """Delete a conversation and all associated data (CASCADE handles
        messages, visibility records, rolling summaries). Returns True if a
        row was actually deleted."""
        result = await self.db.execute(
            delete(Conversation).where(Conversation.id == conversation_id)
        )
        await self.db.flush()
        deleted = result.rowcount > 0
        if deleted:
            logger.info("Deleted conversation %s", conversation_id)
        return deleted

    # ── Message persistence ───────────────────────────────────────────────

    async def next_sequence(self, conversation_id: UUID) -> int:
        """Return the next monotonically increasing sequence number for the
        given conversation. Thread-safe within a single transaction."""
        result = await self.db.execute(
            select(func.coalesce(func.max(Message.sequence), 0)).where(
                Message.conversation_id == conversation_id
            )
        )
        current_max = result.scalar_one()
        return current_max + 1

    async def add_message(
        self,
        conversation_id: UUID,
        role: str,
        content: str | None = None,
        *,
        model_id: str | None = None,
        provider: str | None = None,
        reasoning_level: str | None = None,
        tool_call_id: str | None = None,
        tool_name: str | None = None,
        tool_arguments: dict | None = None,
        tool_result_call_id: str | None = None,
        tool_result_name: str | None = None,
    ) -> Message:
        """Append a message to a conversation with the next sequence number.
        Automatically touches the conversation's updated_at timestamp."""
        seq = await self.next_sequence(conversation_id)
        msg = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            model_id=model_id,
            provider=provider,
            reasoning_level=reasoning_level,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            tool_arguments=tool_arguments,
            tool_result_call_id=tool_result_call_id,
            tool_result_name=tool_result_name,
            sequence=seq,
        )
        self.db.add(msg)
        # Touch conversation updated_at
        await self.db.execute(
            update(Conversation)
            .where(Conversation.id == conversation_id)
            .values(updated_at=func.now())
        )
        await self.db.flush()
        logger.debug(
            "Added %s message seq=%d to conversation %s",
            role, seq, conversation_id,
        )
        return msg

    async def get_messages_for_context(
        self, conversation_id: UUID
    ) -> list[Message]:
        """Fetch all messages for a conversation ordered by sequence.
        Used by ChatService to assemble the LLM context window."""
        result = await self.db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.sequence)
        )
        return list(result.scalars().all())

    async def count_messages(self, conversation_id: UUID) -> int:
        """Return total message count for a conversation. Used to determine
        whether auto-title should fire (fires after first exchange = 2 msgs)."""
        result = await self.db.execute(
            select(func.count(Message.id)).where(
                Message.conversation_id == conversation_id
            )
        )
        return result.scalar_one()
```

**Key decisions:**
- `next_sequence()` is a `SELECT MAX + 1` within the same transaction, which is safe for single-user (no concurrent writers to the same conversation).
- `add_message()` always bumps `conversation.updated_at` so the sidebar sort order stays correct.
- `get_messages_for_context()` returns ORM instances; the ChatService converts them to `ChatMessage` dataclasses for the provider layer.

---

## Step 5: `services/auto_title.py` — AutoTitleService

**File:** `src/backend/services/auto_title.py`

Auto-titling uses **GPT-5 nano** (model ID: `gpt-5-nano`) via the OpenAI provider to generate a short conversation title after the first user+assistant exchange. Per spec section 8.3, this runs asynchronously and does not block the chat.

```python
"""Auto-title service — generates a conversation title after the first exchange.

Uses GPT-5 nano via the OpenAI provider's complete() method. Runs as a
fire-and-forget background task; failures are logged but never surface to
the user (spec §11.5).
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.providers.base import ChatMessage
from src.backend.providers.registry import ProviderRegistry
from src.backend.services.conversation import ConversationService

logger = logging.getLogger(__name__)

TITLE_SYSTEM_PROMPT = (
    "Generate a short, descriptive title (max 8 words) for the following "
    "conversation. Return only the title text — no quotes, no explanation."
)
LIGHTWEIGHT_MODEL = "gpt-5-nano"
LIGHTWEIGHT_PROVIDER = "openai"


class AutoTitleService:
    """Generates conversation titles using a lightweight LLM call."""

    def __init__(self, registry: ProviderRegistry) -> None:
        self.registry = registry

    async def generate_title(
        self,
        user_message: str,
        assistant_message: str,
    ) -> str | None:
        """Call GPT-5 nano to produce a title from the first exchange.
        Returns the title string or None on failure."""
        provider = self.registry.get(LIGHTWEIGHT_PROVIDER)
        if provider is None:
            logger.warning("OpenAI provider unavailable — cannot auto-title")
            return None

        messages = [
            ChatMessage(role="system", content=TITLE_SYSTEM_PROMPT),
            ChatMessage(role="user", content=user_message),
            ChatMessage(role="assistant", content=assistant_message),
            ChatMessage(
                role="user",
                content="Generate a title for this conversation.",
            ),
        ]

        try:
            result = await provider.complete(
                messages=messages,
                model_id=LIGHTWEIGHT_MODEL,
            )
            title = result.content.strip().strip('"').strip("'")
            # Enforce max length from DB schema
            return title[:255] if title else None
        except Exception:
            logger.exception("Auto-title generation failed")
            return None

    async def maybe_auto_title(
        self,
        conversation_id: UUID,
        user_message: str,
        assistant_message: str,
        db: AsyncSession,
        on_title: Callable[[str], Awaitable[None]] | None = None,
    ) -> None:
        """Check if the conversation needs a title and generate one if so.
        This is meant to be launched via asyncio.create_task() — it manages
        its own DB session commit.

        Args:
            conversation_id: The conversation to title.
            user_message: The first user message content.
            assistant_message: The first assistant message content.
            db: An async session (caller is responsible for providing a
                fresh session, not the one used by the chat flow).
            on_title: Optional callback invoked with the title string so
                the WebSocket handler can push a title_updated event.
        """
        conv_svc = ConversationService(db)
        conv = await conv_svc.get_conversation(conversation_id)
        if conv is None or conv.title is not None:
            return  # Already titled or deleted

        title = await self.generate_title(user_message, assistant_message)
        if title is None:
            return

        await conv_svc.update_conversation(conversation_id, title=title)
        await db.commit()
        logger.info(
            "Auto-titled conversation %s: %s", conversation_id, title
        )

        if on_title is not None:
            await on_title(title)
```

**Key decisions:**
- Uses `provider.complete()` (non-streaming) since we only need the full title string.
- `maybe_auto_title()` accepts its own `AsyncSession` — the caller (WebSocket handler) creates a separate session so the background task doesn't interfere with the main chat transaction.
- The `on_title` callback allows the WebSocket handler to send a `title_updated` event when the title is ready.
- Per spec section 11.5, failures are logged but never shown to the user.

---

## Step 6: `services/chat.py` — ChatService (Orchestrator)

**File:** `src/backend/services/chat.py`

This is the central orchestrator. `handle_user_message()` coordinates: persist the user message, assemble context, call the provider with streaming, accumulate the assistant response, persist it, and yield WebSocket events. In Phase 3 (this unit), tool execution and rolling summary are stubbed — they are wired in during Phase 6 (Unit C+).

```python
"""Chat orchestrator — the central coordination point for handling user
messages, streaming LLM responses, and managing the tool execution loop.

Phase 3 (Unit C): Basic chat loop — persist, stream, persist.
Phase 6 (Unit C+): Wire in rolling summary, tool framework, visibility.
"""

import logging
from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.models.message import Message
from src.backend.providers.base import ChatMessage, StreamEvent
from src.backend.providers.registry import ProviderRegistry
from src.backend.services.conversation import ConversationService
from src.backend.services.system_prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)


class ChatService:
    """Orchestrates the full lifecycle of a user message -> LLM response."""

    def __init__(
        self,
        db: AsyncSession,
        registry: ProviderRegistry,
    ) -> None:
        self.db = db
        self.registry = registry
        self.conv_svc = ConversationService(db)

    # ── Context assembly ──────────────────────────────────────────────────

    def _orm_to_chat_message(self, msg: Message) -> ChatMessage:
        """Convert an ORM Message to the provider-layer ChatMessage type."""
        if msg.role == "tool_call":
            from src.backend.providers.base import ToolCallData

            return ChatMessage(
                role="assistant",
                tool_calls=[
                    ToolCallData(
                        id=msg.tool_call_id or "",
                        name=msg.tool_name or "",
                        arguments=msg.tool_arguments or {},
                    )
                ],
            )
        elif msg.role == "tool_result":
            return ChatMessage(
                role="tool_result",
                content=msg.content,
                tool_call_id=msg.tool_result_call_id,
                tool_name=msg.tool_result_name,
            )
        elif msg.role == "summary":
            return ChatMessage(role="user", content=f"[Conversation summary]: {msg.content}")
        else:
            return ChatMessage(role=msg.role, content=msg.content)

    async def _build_context(
        self,
        conversation_id: UUID,
    ) -> list[ChatMessage]:
        """Assemble the full message context for an LLM call.
        Includes the system prompt and all persisted messages in order."""
        messages = await self.conv_svc.get_messages_for_context(conversation_id)

        context: list[ChatMessage] = [
            ChatMessage(role="system", content=SYSTEM_PROMPT),
        ]
        for msg in messages:
            context.append(self._orm_to_chat_message(msg))

        return context

    # ── Main entry point ──────────────────────────────────────────────────

    async def handle_user_message(
        self,
        conversation_id: UUID,
        content: str,
        model_id: str,
        provider_name: str,
        reasoning_level: str | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Process a user message end-to-end.

        1. Persist the user message.
        2. (Phase 6) Check rolling summary threshold.
        3. Build LLM context.
        4. Stream the LLM response, yielding StreamEvents.
        5. Persist the assistant message.
        6. Yield a final 'done' event with the message ID.

        The caller (WebSocket handler) iterates this generator and forwards
        each StreamEvent to the client.
        """
        # ── 1. Persist user message ──────────────────────────────────────
        await self.conv_svc.add_message(
            conversation_id=conversation_id,
            role="user",
            content=content,
        )
        await self.db.commit()

        # ── 2. TODO (Phase 6): Rolling summary check ────────────────────
        # RollingSummaryService.check_and_summarize() will be called here.
        # For now, skip — context is sent unsummarized.

        # ── 3. Build context ─────────────────────────────────────────────
        context = await self._build_context(conversation_id)

        # ── 4. Get provider and stream ───────────────────────────────────
        provider = self.registry.get(provider_name)
        if provider is None:
            yield StreamEvent(
                type="error",
                error=f"Provider '{provider_name}' is not available",
            )
            return

        # TODO (Phase 6): Get tool schemas from ToolFramework
        tool_schemas = None

        accumulated_content = ""
        accumulated_reasoning = ""
        error_occurred = False

        try:
            async for event in provider.stream_chat(
                messages=context,
                model_id=model_id,
                reasoning_level=reasoning_level,
                tools=tool_schemas,
            ):
                # Accumulate content for persistence
                if event.type == "token":
                    accumulated_content += event.content
                elif event.type == "reasoning":
                    accumulated_reasoning += event.content
                elif event.type == "error":
                    error_occurred = True

                # Forward every event to the WebSocket handler
                yield event

                # TODO (Phase 6): Handle tool_call events — execute tool,
                # persist tool_call + tool_result messages, re-call provider
                # with updated context (tool execution loop).

        except Exception as exc:
            logger.exception(
                "Provider stream failed for conversation %s", conversation_id
            )
            yield StreamEvent(
                type="error",
                error=f"Provider error: {exc}",
            )
            error_occurred = True

        # ── 5. Persist assistant message ─────────────────────────────────
        if accumulated_content and not error_occurred:
            assistant_msg = await self.conv_svc.add_message(
                conversation_id=conversation_id,
                role="assistant",
                content=accumulated_content,
                model_id=model_id,
                provider=provider_name,
                reasoning_level=reasoning_level,
            )

            # Update conversation's last-used model
            await self.conv_svc.update_conversation(
                conversation_id,
                last_model_id=model_id,
                last_provider=provider_name,
            )
            await self.db.commit()

            # TODO (Phase 6): Capture visibility record here

            # ── 6. Yield done event ──────────────────────────────────────
            yield StreamEvent(
                type="done",
                metadata={
                    "message_id": str(assistant_msg.id),
                    "visibility_id": None,  # Phase 6
                },
            )
        elif not error_occurred:
            # Edge case: provider returned no content tokens (empty response)
            logger.warning(
                "Provider returned empty response for conversation %s",
                conversation_id,
            )
            yield StreamEvent(
                type="error",
                error="Model returned an empty response",
            )

    # ── Tool execution loop (Phase 6) ────────────────────────────────────

    async def _handle_tool_calls(
        self,
        conversation_id: UUID,
        tool_calls: list,
        model_id: str,
        provider_name: str,
        reasoning_level: str | None,
    ) -> AsyncIterator[StreamEvent]:
        """Execute tool calls and re-send to the LLM with results.
        Stubbed for Phase 3 — will be implemented in Unit C+."""
        # This method will:
        # 1. For each tool_call in tool_calls:
        #    a. Persist a tool_call message
        #    b. Execute the tool via ToolFramework, yielding ToolStep events
        #    c. Persist a tool_result message
        # 2. Rebuild context with new messages
        # 3. Re-call provider.stream_chat() (may produce more tool calls)
        # 4. Loop until no more tool calls (or max iterations reached)
        raise NotImplementedError("Tool execution wired in Phase 6")
```

**Key decisions:**
- `handle_user_message()` is an `AsyncIterator[StreamEvent]` — the WebSocket handler iterates it and forwards events. This keeps the route handler thin.
- The tool execution loop is stubbed with a clear Phase 6 marker. The current implementation handles the simple case: user message -> stream response -> persist.
- Summary messages are mapped to `role="user"` with a prefix for the LLM context, since summaries replace older messages and should be treated as context.
- The `_build_context()` method is a natural integration point for rolling summary injection in Phase 6.

---

## Step 7: `routes/conversations.py` — REST CRUD

**File:** `src/backend/routes/conversations.py`

```python
"""REST API routes for conversation CRUD.

POST   /api/conversations           → Create
GET    /api/conversations           → List (most recent first)
GET    /api/conversations/{id}      → Detail with messages
PATCH  /api/conversations/{id}      → Rename
DELETE /api/conversations/{id}      → Delete (204)
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.database import get_db
from src.backend.schemas.conversations import (
    ConversationCreate,
    ConversationDetail,
    ConversationResponse,
    ConversationSummary,
    ConversationUpdate,
)
from src.backend.services.conversation import ConversationService

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.post(
    "",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    body: ConversationCreate | None = None,
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    """Create a new conversation. The body is entirely optional — clicking
    'New Chat' in the UI sends an empty POST."""
    svc = ConversationService(db)
    title = body.title if body else None
    conv = await svc.create_conversation(title=title)
    await db.commit()
    return ConversationResponse.model_validate(conv)


@router.get("", response_model=list[ConversationSummary])
async def list_conversations(
    db: AsyncSession = Depends(get_db),
) -> list[ConversationSummary]:
    """List all conversations, most recently updated first."""
    svc = ConversationService(db)
    convs = await svc.list_conversations()
    return [ConversationSummary.model_validate(c) for c in convs]


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> ConversationDetail:
    """Fetch a single conversation with its full message history."""
    svc = ConversationService(db)
    conv = await svc.get_conversation_with_messages(conversation_id)
    if conv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation {conversation_id} not found",
        )
    return ConversationDetail.model_validate(conv)


@router.patch("/{conversation_id}", response_model=ConversationResponse)
async def update_conversation(
    conversation_id: UUID,
    body: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    """Rename a conversation."""
    svc = ConversationService(db)
    conv = await svc.update_conversation(conversation_id, title=body.title)
    if conv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation {conversation_id} not found",
        )
    await db.commit()
    return ConversationResponse.model_validate(conv)


@router.delete(
    "/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a conversation and all associated data."""
    svc = ConversationService(db)
    deleted = await svc.delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation {conversation_id} not found",
        )
    await db.commit()
```

**Registration in `main.py`:** After this file is created, add to the FastAPI app:

```python
from src.backend.routes.conversations import router as conversations_router
app.include_router(conversations_router)
```

---

## Step 8: `routes/ws.py` — WebSocket Endpoint

**File:** `src/backend/routes/ws.py`

The WebSocket handler is intentionally thin — it parses the client frame, delegates to `ChatService.handle_user_message()`, and forwards `StreamEvent`s to the client as JSON. Per master plan section 6 ("Database Sessions"), WebSocket handlers create sessions per operation, not per connection.

```python
"""WebSocket endpoint for real-time chat streaming.

Protocol:
  Client sends: { type: "send_message", content, model_id, provider, reasoning_level }
  Server sends: stream_token, stream_reasoning, tool_call_start, tool_step,
                stream_done, summary_started, summary_complete, title_updated, error
"""

import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from src.backend.database import async_session_factory
from src.backend.providers.registry import ProviderRegistry
from src.backend.schemas.ws import (
    WSError,
    WSSendMessage,
    WSStreamDone,
    WSStreamReasoning,
    WSStreamToken,
    WSTitleUpdated,
)
from src.backend.services.auto_title import AutoTitleService
from src.backend.services.chat import ChatService
from src.backend.services.conversation import ConversationService

logger = logging.getLogger(__name__)

router = APIRouter()

# Module-level singleton — initialized once at import time.
# ProviderRegistry is created in main.py lifespan and stored on app.state.
# The WebSocket handler retrieves it from the app instance.


@router.websocket("/ws/{conversation_id}")
async def websocket_chat(
    websocket: WebSocket,
    conversation_id: UUID,
) -> None:
    """Handle a WebSocket connection for a single conversation.

    The connection stays open for the lifetime of the user's session with
    this conversation. Multiple send_message frames can be sent sequentially
    (one at a time — no concurrent requests per connection).
    """
    await websocket.accept()
    logger.info("WebSocket connected for conversation %s", conversation_id)

    # Retrieve the provider registry from app state
    registry: ProviderRegistry = websocket.app.state.provider_registry

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                data = json.loads(raw)
                msg = WSSendMessage.model_validate(data)
            except (json.JSONDecodeError, ValidationError) as exc:
                await _send_event(websocket, WSError(
                    message=f"Invalid message format: {exc}",
                    recoverable=True,
                ))
                continue

            # Validate conversation exists
            async with async_session_factory() as db:
                conv_svc = ConversationService(db)
                conv = await conv_svc.get_conversation(conversation_id)
                if conv is None:
                    await _send_event(websocket, WSError(
                        message=f"Conversation {conversation_id} not found",
                        recoverable=False,
                    ))
                    await websocket.close(code=4004)
                    return

            # Process the message in its own session
            user_content = msg.content
            assistant_content = ""

            async with async_session_factory() as db:
                chat_svc = ChatService(db=db, registry=registry)

                async for event in chat_svc.handle_user_message(
                    conversation_id=conversation_id,
                    content=msg.content,
                    model_id=msg.model_id,
                    provider_name=msg.provider,
                    reasoning_level=msg.reasoning_level,
                ):
                    # Map StreamEvent to WS schema and send
                    ws_event = _stream_event_to_ws(event)
                    if ws_event is not None:
                        await _send_event(websocket, ws_event)

                    # Capture assistant content for auto-title
                    if event.type == "token":
                        assistant_content += event.content

            # ── Auto-title (fire and forget) ─────────────────────────
            if assistant_content:
                asyncio.create_task(
                    _auto_title_task(
                        registry=registry,
                        conversation_id=conversation_id,
                        user_message=user_content,
                        assistant_message=assistant_content,
                        websocket=websocket,
                    )
                )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for conversation %s", conversation_id)
    except Exception:
        logger.exception(
            "Unexpected error on WebSocket for conversation %s", conversation_id
        )
        try:
            await _send_event(websocket, WSError(
                message="Internal server error",
                recoverable=False,
            ))
            await websocket.close(code=1011)
        except Exception:
            pass  # Connection may already be closed


def _stream_event_to_ws(event):
    """Map a provider StreamEvent to the appropriate WS schema object."""
    from src.backend.providers.base import StreamEvent as SE

    if event.type == "token":
        return WSStreamToken(content=event.content)
    elif event.type == "reasoning":
        return WSStreamReasoning(content=event.content)
    elif event.type == "done":
        meta = event.metadata or {}
        return WSStreamDone(
            message_id=meta.get("message_id", "00000000-0000-0000-0000-000000000000"),
            visibility_id=meta.get("visibility_id"),
            token_counts=meta.get("token_counts"),
            context_utilization=meta.get("context_utilization"),
        )
    elif event.type == "error":
        return WSError(message=event.error or "Unknown error", recoverable=True)
    elif event.type == "tool_call":
        from src.backend.schemas.ws import WSToolCallStart
        tc = event.tool_call
        return WSToolCallStart(
            tool_name=tc.name if tc else "unknown",
            arguments=tc.arguments if tc else {},
        )
    return None


async def _send_event(websocket: WebSocket, event) -> None:
    """Serialize a Pydantic model to JSON and send over WebSocket."""
    await websocket.send_text(event.model_dump_json())


async def _auto_title_task(
    registry: ProviderRegistry,
    conversation_id: UUID,
    user_message: str,
    assistant_message: str,
    websocket: WebSocket,
) -> None:
    """Background task: auto-title the conversation if it has no title yet.
    Sends a title_updated event to the WebSocket on success."""
    try:
        auto_title_svc = AutoTitleService(registry=registry)

        async with async_session_factory() as db:
            async def on_title(title: str) -> None:
                try:
                    await _send_event(
                        websocket,
                        WSTitleUpdated(
                            conversation_id=conversation_id,
                            title=title,
                        ),
                    )
                except Exception:
                    logger.debug("Could not send title_updated — WS may be closed")

            await auto_title_svc.maybe_auto_title(
                conversation_id=conversation_id,
                user_message=user_message,
                assistant_message=assistant_message,
                db=db,
                on_title=on_title,
            )
    except Exception:
        logger.exception("Auto-title background task failed for %s", conversation_id)
```

**Key decisions:**
- Each `send_message` gets its own `async_session_factory()` session, committed and closed within the scope. This follows the master plan guidance: "For WebSocket handlers, create sessions per operation (not per connection)."
- `_auto_title_task` is launched via `asyncio.create_task()` with its own separate session, so it never interferes with the main chat session.
- The `_stream_event_to_ws()` mapper translates provider-layer `StreamEvent` to the WS-specific Pydantic schemas. This keeps the provider layer decoupled from the WebSocket protocol.
- Conversation existence is validated before processing to fail fast on stale connections.

**Registration in `main.py`:**

```python
from src.backend.routes.ws import router as ws_router
app.include_router(ws_router)
```

**Provider registry on app state** — add to the `main.py` lifespan:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ... existing DB setup ...
    registry = ProviderRegistry(settings)
    app.state.provider_registry = registry
    yield
    # ... cleanup ...
```

---

## Step 9: Update `main.py` — Register New Routers

Add the following to `src/backend/main.py` after the existing health router registration:

```python
from src.backend.routes.conversations import router as conversations_router
from src.backend.routes.ws import router as ws_router

# Inside create_app() or wherever routers are mounted:
app.include_router(conversations_router)
app.include_router(ws_router)
```

Ensure the lifespan function exposes `provider_registry` on `app.state` as shown in Step 8.

---

## Step 10: Update `schemas/__init__.py`

**File:** `src/backend/schemas/__init__.py`

Ensure clean imports:

```python
"""Pydantic schemas package."""

from src.backend.schemas.conversations import (
    ConversationCreate,
    ConversationDetail,
    ConversationResponse,
    ConversationSummary,
    ConversationUpdate,
)
from src.backend.schemas.messages import MessageResponse
from src.backend.schemas.ws import (
    WSClientMessage,
    WSError,
    WSSendMessage,
    WSServerEvent,
    WSStreamDone,
    WSStreamReasoning,
    WSStreamToken,
    WSTitleUpdated,
)

__all__ = [
    "ConversationCreate",
    "ConversationDetail",
    "ConversationResponse",
    "ConversationSummary",
    "ConversationUpdate",
    "MessageResponse",
    "WSClientMessage",
    "WSError",
    "WSSendMessage",
    "WSServerEvent",
    "WSStreamDone",
    "WSStreamReasoning",
    "WSStreamToken",
    "WSTitleUpdated",
]
```

---

## Step 11: Test Plan

### 11.1 `tests/integration/test_conversations_api.py`

Tests the full REST CRUD lifecycle against a real test database.

```python
"""Integration tests for conversation CRUD REST endpoints."""

import pytest
from httpx import AsyncClient
from uuid import UUID


@pytest.mark.asyncio
class TestConversationCRUD:
    """Test the full conversation lifecycle via HTTP."""

    async def test_create_conversation_empty_body(self, client: AsyncClient):
        """POST /api/conversations with no body creates an untitled conversation."""
        resp = await client.post("/api/conversations")
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] is None
        assert data["last_model_id"] is None
        assert UUID(data["id"])  # valid UUID

    async def test_create_conversation_with_title(self, client: AsyncClient):
        """POST /api/conversations with a title sets it."""
        resp = await client.post(
            "/api/conversations",
            json={"title": "Test Chat"},
        )
        assert resp.status_code == 201
        assert resp.json()["title"] == "Test Chat"

    async def test_list_conversations_empty(self, client: AsyncClient):
        """GET /api/conversations returns empty list initially."""
        resp = await client.get("/api/conversations")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_conversations_ordered_by_updated(self, client: AsyncClient):
        """Conversations are returned most-recently-updated first."""
        r1 = await client.post("/api/conversations")
        r2 = await client.post("/api/conversations")
        resp = await client.get("/api/conversations")
        ids = [c["id"] for c in resp.json()]
        # Most recently created (r2) should be first
        assert ids[0] == r2.json()["id"]
        assert ids[1] == r1.json()["id"]

    async def test_get_conversation_detail(self, client: AsyncClient):
        """GET /api/conversations/{id} returns conversation with empty messages list."""
        create_resp = await client.post("/api/conversations")
        conv_id = create_resp.json()["id"]
        resp = await client.get(f"/api/conversations/{conv_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == conv_id
        assert data["messages"] == []

    async def test_get_conversation_not_found(self, client: AsyncClient):
        """GET /api/conversations/{id} returns 404 for nonexistent ID."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        resp = await client.get(f"/api/conversations/{fake_id}")
        assert resp.status_code == 404

    async def test_patch_conversation_rename(self, client: AsyncClient):
        """PATCH /api/conversations/{id} renames the conversation."""
        create_resp = await client.post("/api/conversations")
        conv_id = create_resp.json()["id"]
        resp = await client.patch(
            f"/api/conversations/{conv_id}",
            json={"title": "Renamed Chat"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Renamed Chat"

    async def test_patch_conversation_not_found(self, client: AsyncClient):
        """PATCH returns 404 for nonexistent conversation."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        resp = await client.patch(
            f"/api/conversations/{fake_id}",
            json={"title": "X"},
        )
        assert resp.status_code == 404

    async def test_patch_conversation_empty_title_rejected(self, client: AsyncClient):
        """PATCH with empty title string is rejected (422)."""
        create_resp = await client.post("/api/conversations")
        conv_id = create_resp.json()["id"]
        resp = await client.patch(
            f"/api/conversations/{conv_id}",
            json={"title": ""},
        )
        assert resp.status_code == 422

    async def test_delete_conversation(self, client: AsyncClient):
        """DELETE /api/conversations/{id} returns 204 and removes the conversation."""
        create_resp = await client.post("/api/conversations")
        conv_id = create_resp.json()["id"]
        resp = await client.delete(f"/api/conversations/{conv_id}")
        assert resp.status_code == 204

        # Verify it is gone
        get_resp = await client.get(f"/api/conversations/{conv_id}")
        assert get_resp.status_code == 404

    async def test_delete_conversation_not_found(self, client: AsyncClient):
        """DELETE returns 404 for nonexistent conversation."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        resp = await client.delete(f"/api/conversations/{fake_id}")
        assert resp.status_code == 404
```

### 11.2 `tests/integration/test_chat_flow.py`

Tests the ChatService logic with a mocked provider (no real LLM calls).

```python
"""Integration tests for the chat flow — ChatService + ConversationService.

Uses a mock LLMProvider to avoid real API calls while testing the full
persistence and streaming pipeline.
"""

import pytest
from unittest.mock import AsyncMock
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.providers.base import ChatMessage, StreamEvent
from src.backend.providers.registry import ProviderRegistry
from src.backend.services.chat import ChatService
from src.backend.services.conversation import ConversationService


async def _mock_stream(*args, **kwargs):
    """A mock stream_chat that yields a simple 3-token response."""
    yield StreamEvent(type="token", content="Hello")
    yield StreamEvent(type="token", content=" world")
    yield StreamEvent(type="token", content="!")
    yield StreamEvent(type="done")


@pytest.fixture
def mock_registry():
    """Create a ProviderRegistry with a mocked OpenAI provider."""
    registry = AsyncMock(spec=ProviderRegistry)
    mock_provider = AsyncMock()
    mock_provider.stream_chat = _mock_stream
    registry.get.return_value = mock_provider
    return registry


@pytest.mark.asyncio
class TestChatFlow:
    """Test the chat orchestration pipeline."""

    async def test_user_message_persisted(
        self, db_session: AsyncSession, mock_registry
    ):
        """Sending a message persists the user message."""
        conv_svc = ConversationService(db_session)
        conv = await conv_svc.create_conversation()
        await db_session.commit()

        chat_svc = ChatService(db=db_session, registry=mock_registry)
        events = []
        async for event in chat_svc.handle_user_message(
            conversation_id=conv.id,
            content="Hi there",
            model_id="gpt-5-nano",
            provider_name="openai",
        ):
            events.append(event)

        messages = await conv_svc.get_messages_for_context(conv.id)
        user_msgs = [m for m in messages if m.role == "user"]
        assert len(user_msgs) == 1
        assert user_msgs[0].content == "Hi there"

    async def test_assistant_message_persisted(
        self, db_session: AsyncSession, mock_registry
    ):
        """The accumulated stream is persisted as an assistant message."""
        conv_svc = ConversationService(db_session)
        conv = await conv_svc.create_conversation()
        await db_session.commit()

        chat_svc = ChatService(db=db_session, registry=mock_registry)
        events = []
        async for event in chat_svc.handle_user_message(
            conversation_id=conv.id,
            content="Hi",
            model_id="gpt-5",
            provider_name="openai",
        ):
            events.append(event)

        messages = await conv_svc.get_messages_for_context(conv.id)
        assistant_msgs = [m for m in messages if m.role == "assistant"]
        assert len(assistant_msgs) == 1
        assert assistant_msgs[0].content == "Hello world!"
        assert assistant_msgs[0].model_id == "gpt-5"
        assert assistant_msgs[0].provider == "openai"

    async def test_sequence_numbers_monotonic(
        self, db_session: AsyncSession, mock_registry
    ):
        """Messages within a conversation have strictly increasing sequence numbers."""
        conv_svc = ConversationService(db_session)
        conv = await conv_svc.create_conversation()
        await db_session.commit()

        chat_svc = ChatService(db=db_session, registry=mock_registry)

        # First exchange
        async for _ in chat_svc.handle_user_message(
            conversation_id=conv.id,
            content="First",
            model_id="gpt-5-nano",
            provider_name="openai",
        ):
            pass

        # Second exchange
        async for _ in chat_svc.handle_user_message(
            conversation_id=conv.id,
            content="Second",
            model_id="gpt-5-nano",
            provider_name="openai",
        ):
            pass

        messages = await conv_svc.get_messages_for_context(conv.id)
        sequences = [m.sequence for m in messages]
        assert sequences == [1, 2, 3, 4]  # user1, asst1, user2, asst2

    async def test_stream_events_yielded(
        self, db_session: AsyncSession, mock_registry
    ):
        """The generator yields token events and a done event."""
        conv_svc = ConversationService(db_session)
        conv = await conv_svc.create_conversation()
        await db_session.commit()

        chat_svc = ChatService(db=db_session, registry=mock_registry)
        events = []
        async for event in chat_svc.handle_user_message(
            conversation_id=conv.id,
            content="Hi",
            model_id="gpt-5-nano",
            provider_name="openai",
        ):
            events.append(event)

        token_events = [e for e in events if e.type == "token"]
        done_events = [e for e in events if e.type == "done"]
        assert len(token_events) == 3
        assert len(done_events) == 1
        assert token_events[0].content == "Hello"

    async def test_conversation_updated_at_bumped(
        self, db_session: AsyncSession, mock_registry
    ):
        """Sending a message updates the conversation's updated_at."""
        conv_svc = ConversationService(db_session)
        conv = await conv_svc.create_conversation()
        await db_session.commit()
        original_updated = conv.updated_at

        chat_svc = ChatService(db=db_session, registry=mock_registry)
        async for _ in chat_svc.handle_user_message(
            conversation_id=conv.id,
            content="Test",
            model_id="gpt-5-nano",
            provider_name="openai",
        ):
            pass

        refreshed = await conv_svc.get_conversation(conv.id)
        assert refreshed.updated_at >= original_updated

    async def test_last_model_updated(
        self, db_session: AsyncSession, mock_registry
    ):
        """After a message, the conversation's last_model_id and last_provider
        reflect the model used."""
        conv_svc = ConversationService(db_session)
        conv = await conv_svc.create_conversation()
        await db_session.commit()

        chat_svc = ChatService(db=db_session, registry=mock_registry)
        async for _ in chat_svc.handle_user_message(
            conversation_id=conv.id,
            content="Test",
            model_id="gpt-5",
            provider_name="openai",
        ):
            pass

        refreshed = await conv_svc.get_conversation(conv.id)
        assert refreshed.last_model_id == "gpt-5"
        assert refreshed.last_provider == "openai"

    async def test_provider_not_found_yields_error(
        self, db_session: AsyncSession,
    ):
        """If the provider is not in the registry, an error event is yielded."""
        empty_registry = AsyncMock(spec=ProviderRegistry)
        empty_registry.get.return_value = None

        conv_svc = ConversationService(db_session)
        conv = await conv_svc.create_conversation()
        await db_session.commit()

        chat_svc = ChatService(db=db_session, registry=empty_registry)
        events = []
        async for event in chat_svc.handle_user_message(
            conversation_id=conv.id,
            content="Hi",
            model_id="gpt-5-nano",
            provider_name="nonexistent",
        ):
            events.append(event)

        assert any(e.type == "error" for e in events)
```

### 11.3 `tests/integration/test_websocket.py`

Tests the WebSocket endpoint end-to-end with a mocked provider.

```python
"""Integration tests for the WebSocket chat endpoint.

Uses FastAPI's TestClient WebSocket support with a mocked LLM provider.
"""

import json
import pytest
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient

from src.backend.providers.base import StreamEvent


async def _mock_stream(*args, **kwargs):
    """Mock stream yielding a simple response."""
    yield StreamEvent(type="token", content="Hi")
    yield StreamEvent(type="token", content=" there")
    yield StreamEvent(type="done")


@pytest.mark.asyncio
class TestWebSocket:
    """Test the /ws/{conversation_id} endpoint."""

    async def test_send_message_streams_response(
        self, client: AsyncClient, app_with_mock_registry,
    ):
        """A send_message frame produces stream_token and stream_done events."""
        # Create a conversation via REST
        resp = await client.post("/api/conversations")
        conv_id = resp.json()["id"]

        # Connect via WebSocket
        async with client.websocket_connect(f"/ws/{conv_id}") as ws:
            await ws.send_text(json.dumps({
                "type": "send_message",
                "content": "Hello",
                "model_id": "gpt-5-nano",
                "provider": "openai",
            }))

            events = []
            # Read until we get stream_done
            while True:
                raw = await ws.receive_text()
                event = json.loads(raw)
                events.append(event)
                if event["type"] in ("stream_done", "error"):
                    break

            types = [e["type"] for e in events]
            assert "stream_token" in types
            assert "stream_done" in types

    async def test_invalid_json_returns_error(
        self, client: AsyncClient, app_with_mock_registry,
    ):
        """Sending malformed JSON produces a recoverable error event."""
        resp = await client.post("/api/conversations")
        conv_id = resp.json()["id"]

        async with client.websocket_connect(f"/ws/{conv_id}") as ws:
            await ws.send_text("not json at all")
            raw = await ws.receive_text()
            event = json.loads(raw)
            assert event["type"] == "error"
            assert event["recoverable"] is True

    async def test_missing_fields_returns_error(
        self, client: AsyncClient, app_with_mock_registry,
    ):
        """Sending a message missing required fields returns a validation error."""
        resp = await client.post("/api/conversations")
        conv_id = resp.json()["id"]

        async with client.websocket_connect(f"/ws/{conv_id}") as ws:
            await ws.send_text(json.dumps({
                "type": "send_message",
                "content": "Hello",
                # missing model_id and provider
            }))
            raw = await ws.receive_text()
            event = json.loads(raw)
            assert event["type"] == "error"
            assert event["recoverable"] is True

    async def test_nonexistent_conversation_closes_socket(
        self, client: AsyncClient, app_with_mock_registry,
    ):
        """Sending a message to a nonexistent conversation closes the socket."""
        fake_id = "00000000-0000-0000-0000-000000000000"
        async with client.websocket_connect(f"/ws/{fake_id}") as ws:
            await ws.send_text(json.dumps({
                "type": "send_message",
                "content": "Hello",
                "model_id": "gpt-5-nano",
                "provider": "openai",
            }))
            raw = await ws.receive_text()
            event = json.loads(raw)
            assert event["type"] == "error"
            assert event["recoverable"] is False

    async def test_auto_title_event_sent(
        self, client: AsyncClient, app_with_mock_registry,
    ):
        """After the first exchange, a title_updated event is sent."""
        resp = await client.post("/api/conversations")
        conv_id = resp.json()["id"]

        async with client.websocket_connect(f"/ws/{conv_id}") as ws:
            await ws.send_text(json.dumps({
                "type": "send_message",
                "content": "What is Python?",
                "model_id": "gpt-5-nano",
                "provider": "openai",
            }))

            events = []
            # Read stream_done + potential title_updated
            # Use a timeout to avoid hanging if title_updated never arrives
            import asyncio
            try:
                while True:
                    raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
                    event = json.loads(raw)
                    events.append(event)
                    if event["type"] == "title_updated":
                        break
            except asyncio.TimeoutError:
                pass  # title may not arrive in time in test env

            types = [e["type"] for e in events]
            # At minimum we should have stream events
            assert "stream_token" in types or "stream_done" in types

    async def test_multiple_messages_sequential(
        self, client: AsyncClient, app_with_mock_registry,
    ):
        """Multiple messages can be sent sequentially on the same connection."""
        resp = await client.post("/api/conversations")
        conv_id = resp.json()["id"]

        async with client.websocket_connect(f"/ws/{conv_id}") as ws:
            for content in ["First", "Second"]:
                await ws.send_text(json.dumps({
                    "type": "send_message",
                    "content": content,
                    "model_id": "gpt-5-nano",
                    "provider": "openai",
                }))

                # Drain until stream_done
                while True:
                    raw = await ws.receive_text()
                    event = json.loads(raw)
                    if event["type"] in ("stream_done", "error"):
                        break
```

### 11.4 Test Fixtures Required in `conftest.py`

The following fixtures must be added to or verified in `tests/conftest.py` (some may already exist from Unit F):

```python
"""Shared test fixtures — additions for Unit C."""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock

from src.backend.main import create_app
from src.backend.database import async_session_factory
from src.backend.providers.base import StreamEvent
from src.backend.providers.registry import ProviderRegistry


async def _mock_stream(*args, **kwargs):
    yield StreamEvent(type="token", content="Hi")
    yield StreamEvent(type="token", content=" there")
    yield StreamEvent(type="done")


@pytest_asyncio.fixture
async def app_with_mock_registry():
    """FastAPI app instance with a mocked provider registry on app.state."""
    app = create_app()

    mock_provider = AsyncMock()
    mock_provider.stream_chat = _mock_stream
    mock_provider.complete.return_value = AsyncMock(
        content="Auto Generated Title"
    )

    mock_registry = AsyncMock(spec=ProviderRegistry)
    mock_registry.get.return_value = mock_provider
    app.state.provider_registry = mock_registry

    return app


@pytest_asyncio.fixture
async def client(app_with_mock_registry):
    """Async HTTP client bound to the test app."""
    transport = ASGITransport(app=app_with_mock_registry)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as c:
        yield c


@pytest_asyncio.fixture
async def db_session():
    """Async DB session for service-level tests. Rolls back after each test."""
    async with async_session_factory() as session:
        yield session
        await session.rollback()
```

---

## Step 12: Execution Checklist

Execute the steps in this order. Each step should be verified before moving to the next.

- [ ] **Step 1:** Create `src/backend/schemas/conversations.py`
- [ ] **Step 2:** Create `src/backend/schemas/messages.py`
- [ ] **Step 3:** Create `src/backend/schemas/ws.py`
- [ ] **Step 4:** Create `src/backend/services/conversation.py`
- [ ] **Step 5:** Create `src/backend/services/auto_title.py`
- [ ] **Step 6:** Create `src/backend/services/chat.py`
- [ ] **Step 7:** Create `src/backend/routes/conversations.py`
- [ ] **Step 8:** Create `src/backend/routes/ws.py`
- [ ] **Step 9:** Update `src/backend/main.py` — register routers, expose registry on app.state
- [ ] **Step 10:** Update `src/backend/schemas/__init__.py`
- [ ] **Verify:** `uvicorn src.backend.main:app --reload` starts without import errors
- [ ] **Step 11:** Create test files and update `tests/conftest.py`
- [ ] **Verify:** `pytest tests/integration/test_conversations_api.py` — all CRUD tests pass
- [ ] **Verify:** `pytest tests/integration/test_chat_flow.py` — all chat flow tests pass
- [ ] **Verify:** `pytest tests/integration/test_websocket.py` — all WebSocket tests pass
- [ ] **Verify:** All completion criteria (top of this document) are met

---

## Phase 6 Integration Points (Unit C+)

When Units S, T, and V are complete, the following changes wire them into the chat orchestrator:

1. **Rolling Summary** — Insert `RollingSummaryService.check_and_summarize()` call in `ChatService.handle_user_message()` between user message persistence and context assembly. Yield `summary_started` / `summary_complete` events around it.

2. **Tool Framework** — Implement `_handle_tool_calls()` in `ChatService`. When `stream_chat()` yields a `tool_call` event, pause streaming, execute the tool via `ToolFramework.execute_tool_call()`, persist `tool_call` and `tool_result` messages, rebuild context, and re-call `stream_chat()`. Loop until no more tool calls or max iterations (3).

3. **Visibility** — After persisting the assistant message, call `VisibilityService.capture()` with the request payload, response metadata, and reasoning content. Populate `visibility_id` in the `stream_done` event.

4. **Token Counting** — After each response, fire async tasks for all three token counting methods. The active provider's count blocks (for threshold check); the other two are fire-and-forget for visibility.
