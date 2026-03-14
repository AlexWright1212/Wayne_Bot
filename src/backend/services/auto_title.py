"""Auto-title generation for new conversations."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.config import settings
from src.backend.providers.base import ChatMessage
from src.backend.providers.registry import ProviderRegistry
from src.backend.services.conversation import ConversationService

logger = logging.getLogger(__name__)

_TITLE_PROMPT = (
    "Generate a short, descriptive title (under 60 characters, no quotes) "
    "for a conversation that started with the following exchange.\n\n"
    "User: {user_message}\n\n"
    "Assistant: {assistant_message}\n\n"
    "Respond with only the title text."
)


class AutoTitleService:
    def __init__(
        self,
        provider_registry: ProviderRegistry,
        conversation_service: ConversationService,
    ) -> None:
        self._registry = provider_registry
        self._conv_service = conversation_service

    async def generate_title(
        self,
        conversation_id: uuid.UUID,
        user_message: str,
        assistant_message: str,
        db: AsyncSession,
    ) -> str | None:
        """Generate and persist a title. Returns title on success, None on failure.

        Failures are swallowed — auto-titling is non-critical (spec §11.5).
        """
        try:
            provider = self._registry.get("openai")
            prompt = _TITLE_PROMPT.format(
                user_message=user_message[:500],
                assistant_message=assistant_message[:500],
            )
            result = await provider.complete(
                messages=[ChatMessage(role="user", content=prompt)],
                model_id=settings.lightweight_model,
            )
            title = result.content.strip().strip('"\'').strip()
            if not title:
                return None
            title = title[:255]
            await self._conv_service.update(conversation_id, title, db)
            logger.info("Auto-titled conversation %s: %r", conversation_id, title)
            return title
        except Exception:
            logger.exception("Auto-title failed for conversation %s", conversation_id)
            return None
