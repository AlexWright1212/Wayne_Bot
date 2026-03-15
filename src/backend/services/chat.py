"""Central chat orchestrator.

handle_user_message() is an async generator that coordinates the full
chat flow. Units S (rolling summary), T (tools), and V (visibility)
will wire additional behavior into this method in later phases.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncGenerator, Callable, Awaitable

from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.exceptions import ProviderError
from src.backend.models.message import MessageRole
from src.backend.providers.base import ChatMessage, StreamEvent
from src.backend.providers.registry import ProviderRegistry
from src.backend.services.auto_title import AutoTitleService
from src.backend.services.conversation import ConversationService
from src.backend.services.system_prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)


class ChatService:
    def __init__(
        self,
        provider_registry: ProviderRegistry,
        conversation_service: ConversationService,
        auto_title_service: AutoTitleService,
    ) -> None:
        self._registry = provider_registry
        self._conv_service = conversation_service
        self._auto_title_service = auto_title_service

    async def handle_user_message(
        self,
        conversation_id: uuid.UUID,
        content: str,
        model_id: str,
        provider_name: str,
        reasoning_level: str | None,
        db: AsyncSession,
        on_title_updated: Callable[[str], Awaitable[None]] | None = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Process a user message and stream LLM response events.

        This is an async generator. Iterate with:
            async for event in chat_service.handle_user_message(...):

        Auto-title fires as a background task after the first exchange.
        on_title_updated(title) is called when the title is ready.
        """
        # 1. Persist user message
        user_msg = await self._conv_service.add_message(
            conversation_id=conversation_id,
            role=MessageRole.user,
            content=content,
            db=db,
        )

        # 2. Assemble context: system prompt + full conversation history
        history = await self._conv_service.get_messages_as_chat(conversation_id, db)
        messages: list[ChatMessage] = [
            ChatMessage(role="system", content=SYSTEM_PROMPT),
            *history,
        ]

        # 3. Stream from provider
        provider = self._registry.get(provider_name)
        accumulated_content = ""
        accumulated_reasoning = ""

        try:
            async for event in provider.stream_chat(
                messages=messages,
                model_id=model_id,
                reasoning_level=reasoning_level,
            ):
                if event.type == "token":
                    accumulated_content += event.content
                    yield event

                elif event.type == "reasoning":
                    accumulated_reasoning += event.content
                    yield event

                elif event.type == "done":
                    # 4. Persist assistant message
                    assistant_msg = await self._conv_service.add_message(
                        conversation_id=conversation_id,
                        role=MessageRole.assistant,
                        content=accumulated_content,
                        db=db,
                        model_id=model_id,
                        provider=provider_name,
                        reasoning_level=reasoning_level,
                    )

                    # 5. Update conversation's last-used model/provider
                    conv = await self._conv_service.get(conversation_id, db)
                    conv.last_model_id = model_id
                    conv.last_provider = provider_name
                    await db.flush()

                    # Enrich done event with persisted message_id
                    metadata = dict(event.metadata or {})
                    metadata["message_id"] = str(assistant_msg.id)
                    yield StreamEvent(type="done", metadata=metadata)

                    # 6. Fire auto-title after the first exchange (2 messages total)
                    msg_count = await self._conv_service.count_messages(
                        conversation_id, db
                    )
                    if msg_count == 2 and on_title_updated is not None:
                        asyncio.create_task(
                            self._run_auto_title(
                                conversation_id=conversation_id,
                                user_content=content,
                                assistant_content=accumulated_content,
                                on_title_updated=on_title_updated,
                            )
                        )
                    return

                elif event.type == "error":
                    yield event
                    return

        except ProviderError as exc:
            logger.error("Provider error during stream: %s", exc)
            yield StreamEvent(type="error", error=str(exc))

    async def _run_auto_title(
        self,
        conversation_id: uuid.UUID,
        user_content: str,
        assistant_content: str,
        on_title_updated: Callable[[str], Awaitable[None]],
    ) -> None:
        """Background task: generate title with its own DB session."""
        from src.backend.database import async_session_factory

        async with async_session_factory() as db:
            try:
                title = await self._auto_title_service.generate_title(
                    conversation_id=conversation_id,
                    user_message=user_content,
                    assistant_message=assistant_content,
                    db=db,
                )
                await db.commit()
            except Exception:
                logger.exception("Auto-title background task failed")
                await db.rollback()
                return

        if title:
            try:
                await on_title_updated(title)
            except Exception:
                logger.warning("title_updated callback failed (WebSocket likely closed)")
