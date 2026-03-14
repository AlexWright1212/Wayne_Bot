"""Conversation CRUD and message persistence."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.backend.models.conversation import Conversation
from src.backend.models.message import Message, MessageRole
from src.backend.providers.base import ChatMessage, ToolCallData

logger = logging.getLogger(__name__)


class ConversationService:
    async def create(self, db: AsyncSession) -> Conversation:
        conv = Conversation()
        db.add(conv)
        await db.flush()
        await db.refresh(conv)
        return conv

    async def list_all(self, db: AsyncSession) -> list[Conversation]:
        result = await db.execute(
            select(Conversation).order_by(Conversation.updated_at.desc())
        )
        return list(result.scalars().all())

    async def get(self, conversation_id: uuid.UUID, db: AsyncSession) -> Conversation:
        result = await db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conv = result.scalar_one_or_none()
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conv

    async def get_with_messages(
        self, conversation_id: uuid.UUID, db: AsyncSession
    ) -> Conversation:
        result = await db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .options(selectinload(Conversation.messages))
        )
        conv = result.scalar_one_or_none()
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conv

    async def update(
        self, conversation_id: uuid.UUID, title: str | None, db: AsyncSession
    ) -> Conversation:
        conv = await self.get(conversation_id, db)
        if title is not None:
            conv.title = title
        conv.updated_at = datetime.now(UTC).replace(tzinfo=None)
        await db.flush()
        await db.refresh(conv)
        return conv

    async def delete(self, conversation_id: uuid.UUID, db: AsyncSession) -> None:
        conv = await self.get(conversation_id, db)
        await db.delete(conv)
        await db.flush()

    async def _next_sequence(
        self, conversation_id: uuid.UUID, db: AsyncSession
    ) -> int:
        result = await db.execute(
            select(func.max(Message.sequence)).where(
                Message.conversation_id == conversation_id
            )
        )
        max_seq = result.scalar_one_or_none()
        return (max_seq or 0) + 1

    async def add_message(
        self,
        conversation_id: uuid.UUID,
        role: MessageRole,
        content: str | None,
        db: AsyncSession,
        **kwargs: Any,
    ) -> Message:
        sequence = await self._next_sequence(conversation_id, db)
        msg = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            sequence=sequence,
            **kwargs,
        )
        db.add(msg)
        # Touch conversation updated_at for sidebar ordering
        result = await db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conv = result.scalar_one()
        conv.updated_at = datetime.now(UTC).replace(tzinfo=None)
        await db.flush()
        await db.refresh(msg)
        return msg

    async def get_messages_as_chat(
        self, conversation_id: uuid.UUID, db: AsyncSession
    ) -> list[ChatMessage]:
        """Load messages ordered by sequence and convert to ChatMessage objects."""
        result = await db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.sequence)
        )
        messages = list(result.scalars().all())
        return [self._to_chat_message(m) for m in messages]

    def _to_chat_message(self, msg: Message) -> ChatMessage:
        if msg.role == MessageRole.tool_call:
            return ChatMessage(
                role="assistant",
                tool_calls=[
                    ToolCallData(
                        id=msg.tool_call_id or "",
                        name=msg.tool_name or "",
                        arguments=json.dumps(msg.tool_arguments or {}),
                    )
                ],
            )
        if msg.role == MessageRole.tool_result:
            return ChatMessage(
                role="tool_result",
                content=msg.content,
                tool_call_id=msg.tool_result_call_id,
                tool_name=msg.tool_result_name,
            )
        if msg.role == MessageRole.summary:
            # Summary messages become system messages in the context window
            return ChatMessage(role="system", content=msg.content)
        # user, assistant, system
        return ChatMessage(role=msg.role.value, content=msg.content)  # type: ignore[arg-type]

    async def count_messages(
        self, conversation_id: uuid.UUID, db: AsyncSession
    ) -> int:
        result = await db.execute(
            select(func.count(Message.id)).where(
                Message.conversation_id == conversation_id
            )
        )
        return result.scalar_one()
