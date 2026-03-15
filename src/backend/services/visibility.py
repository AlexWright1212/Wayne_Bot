"""Visibility capture service.

Captures full API payload, token counts, reasoning, summaries, and tool traces
for every assistant message.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.config import Settings
from src.backend.models.message import Message
from src.backend.models.visibility import VisibilityRecord
from src.backend.providers.base import ChatMessage
from src.backend.services.token_counter import TokenCounter
from src.backend.tools.base import ToolStep

logger = logging.getLogger(__name__)

# Map provider name to the column name on VisibilityRecord
_PROVIDER_COLUMN = {
    "openai": "tokens_openai",
    "anthropic": "tokens_anthropic",
    "openrouter": "tokens_openrouter",
}


class VisibilityService:
    def __init__(self, token_counter: TokenCounter, settings: Settings) -> None:
        self._token_counter = token_counter
        self._settings = settings

    async def capture(
        self,
        message_id: uuid.UUID,
        request_payload: dict,
        response_metadata: dict,
        messages: list[ChatMessage],
        model_id: str,
        provider: str,
        db: AsyncSession,
        reasoning_content: str | None = None,
        summary_event=None,  # SummaryResult | None
        tool_trace: list[ToolStep] | None = None,
    ) -> uuid.UUID:
        """Capture visibility data for an assistant message.

        Computes the active provider token count synchronously.
        Fires background tasks for the other two provider counts.
        Returns the visibility record ID.
        """
        # --- Active provider token count (synchronous) ---
        active_token_count: int | None = None
        context_window_size: int | None = None
        try:
            active_token_count = await self._token_counter.count_for_provider(
                messages, provider, model_id
            )
            context_window_size = self._token_counter.get_context_window(model_id, provider)
        except Exception:
            logger.exception("Active provider token count failed (message_id=%s)", message_id)

        # --- Extract output tokens from response_metadata ---
        output_tokens: int | None = None
        if response_metadata:
            usage = response_metadata.get("usage") or {}
            output_tokens = usage.get("completion_tokens") or usage.get("output_tokens")

        # --- Serialize tool trace ---
        tool_trace_json: dict | None = None
        if tool_trace:
            tool_trace_json = {
                "steps": [
                    {
                        "name": step.name,
                        "status": step.status,
                        "data": step.data,
                        "duration_ms": step.duration_ms,
                    }
                    for step in tool_trace
                ]
            }

        # --- Serialize summary event ---
        summary_event_json: dict | None = None
        if summary_event is not None:
            try:
                summary_event_json = {
                    "summary_text": summary_event.summary_text,
                    "summarized_message_ids": [
                        str(mid) for mid in summary_event.summarized_message_ids
                    ],
                    "tokens_before": summary_event.tokens_before,
                    "tokens_after": summary_event.tokens_after,
                    "model_used": summary_event.model_used,
                }
            except Exception:
                logger.exception("Failed to serialize summary_event")

        # --- Determine which column gets the active count ---
        active_col = _PROVIDER_COLUMN.get(provider)
        token_kwargs: dict = {}
        if active_col:
            token_kwargs[active_col] = active_token_count

        # --- Create the visibility record ---
        record = VisibilityRecord(
            message_id=message_id,
            request_payload=request_payload,
            response_metadata=response_metadata,
            output_tokens=output_tokens,
            context_window_size=context_window_size,
            active_token_count=active_token_count,
            reasoning_content=reasoning_content,
            summary_event=summary_event_json,
            tool_trace=tool_trace_json,
            **token_kwargs,
        )
        db.add(record)
        await db.flush()
        await db.refresh(record)
        record_id = record.id

        # --- Background tasks for non-active provider counts ---
        other_providers = [p for p in ("openai", "anthropic", "openrouter") if p != provider]
        for bg_provider in other_providers:
            asyncio.create_task(
                self._compute_background_token_count(
                    record_id=record_id,
                    provider=bg_provider,
                    messages=messages,
                    model_id=model_id,
                )
            )

        return record_id

    async def _compute_background_token_count(
        self,
        record_id: uuid.UUID,
        provider: str,
        messages: list[ChatMessage],
        model_id: str,
    ) -> None:
        """Compute a non-active provider's token count and update the record."""
        from src.backend.database import async_session_factory

        column = _PROVIDER_COLUMN.get(provider)
        if not column:
            return
        try:
            count = await self._token_counter.count_for_provider(messages, provider, model_id)
            async with async_session_factory() as db:
                result = await db.get(VisibilityRecord, record_id)
                if result:
                    setattr(result, column, count)
                    await db.commit()
        except Exception:
            logger.exception(
                "Background token count failed (provider=%s, record_id=%s)", provider, record_id
            )

    async def get_visibility(
        self, message_id: uuid.UUID, db: AsyncSession
    ) -> VisibilityRecord | None:
        """Return the visibility record for a message, or None if not found."""
        result = await db.execute(
            select(VisibilityRecord).where(VisibilityRecord.message_id == message_id)
        )
        return result.scalar_one_or_none()

    async def get_latest_token_counts(
        self, conversation_id: uuid.UUID, db: AsyncSession
    ) -> VisibilityRecord | None:
        """Return the most recent visibility record for a conversation."""
        result = await db.execute(
            select(VisibilityRecord)
            .join(Message, VisibilityRecord.message_id == Message.id)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.sequence.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def update_auto_title_data(
        self,
        message_id: uuid.UUID,
        title_prompt: str,
        title_response: str,
        db: AsyncSession,
    ) -> None:
        """Merge auto-title generation details into the visibility record's response_metadata."""
        record = await self.get_visibility(message_id, db)
        if record is None:
            return
        existing = dict(record.response_metadata or {})
        existing["auto_title"] = {
            "prompt": title_prompt,
            "response": title_response,
        }
        record.response_metadata = existing
        await db.flush()
