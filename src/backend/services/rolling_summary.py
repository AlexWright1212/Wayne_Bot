"""Rolling summary service — compresses old messages when the context window fills up.

Triggered when a conversation's token count exceeds summary_threshold (80%) of the
active model's context window. Summarizes the oldest messages using the lightweight
model, persists the result, and returns a compressed messages list.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.config import Settings
from src.backend.models.message import Message, MessageRole
from src.backend.models.rolling_summary import RollingSummary
from src.backend.providers.base import ChatMessage
from src.backend.providers.registry import ProviderRegistry
from src.backend.services.token_counter import TokenCounter

logger = logging.getLogger(__name__)


@dataclass
class SummaryResult:
    """Metadata about a completed rolling summary operation."""

    summary_text: str
    summarized_message_ids: list[uuid.UUID]
    tokens_before: int
    tokens_after: int
    model_used: str


class RollingSummaryService:
    def __init__(
        self,
        token_counter: TokenCounter,
        provider_registry: ProviderRegistry,
        settings: Settings,
    ) -> None:
        self._token_counter = token_counter
        self._provider_registry = provider_registry
        self._settings = settings

    async def check_and_summarize(
        self,
        conversation_id: uuid.UUID,
        messages: list[ChatMessage],
        model_id: str,
        provider: str,
        db: AsyncSession,
    ) -> tuple[list[ChatMessage], SummaryResult | None]:
        """Check if the context is near capacity and summarize if needed.

        messages[0] is the system prompt (not in DB).
        messages[1:] correspond to DB rows in sequence order.

        Returns (possibly-compressed messages, SummaryResult or None).
        """
        if len(messages) <= 1:
            # Only the system prompt — nothing to summarize
            return messages, None

        tokens_before = await self._token_counter.count_for_provider(messages, provider, model_id)
        context_window = self._token_counter.get_context_window(model_id, provider)

        if context_window == 0:
            logger.warning("Unknown context window for model %s/%s — skipping summary", provider, model_id)
            return messages, None

        threshold = self._settings.summary_threshold * context_window
        if tokens_before < threshold:
            return messages, None

        logger.info(
            "Rolling summary triggered: %d tokens >= %.0f threshold (%.0f%% of %d)",
            tokens_before,
            threshold,
            self._settings.summary_threshold * 100,
            context_window,
        )

        # Fetch DB message IDs in sequence order to map back to UUIDs
        id_result = await db.execute(
            select(Message.id)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.sequence)
        )
        db_ids: list[uuid.UUID] = list(id_result.scalars().all())
        # db_ids[i] corresponds to messages[i + 1]  (messages[0] is the system prompt)

        to_summarize, to_summarize_ids, remaining = self._select_messages_to_summarize(
            messages, context_window, db_ids
        )

        if not to_summarize:
            logger.warning("No messages selected for summarization — skipping")
            return messages, None

        summary_text = await self._generate_summary(to_summarize)

        # Build the compressed messages list
        summary_chat_msg = ChatMessage(
            role="system",
            content=f"[Conversation summary]\n{summary_text}",
        )
        new_messages = [messages[0], summary_chat_msg, *remaining]

        tokens_after = await self._token_counter.count_for_provider(new_messages, provider, model_id)

        # Persist the summary message to the DB
        seq_result = await db.execute(
            select(func.max(Message.sequence)).where(
                Message.conversation_id == conversation_id
            )
        )
        next_seq = (seq_result.scalar_one_or_none() or 0) + 1

        summary_msg_row = Message(
            conversation_id=conversation_id,
            role=MessageRole.summary,
            content=f"[Conversation summary]\n{summary_text}",
            sequence=next_seq,
        )
        db.add(summary_msg_row)

        # Persist the RollingSummary record
        summary_record = RollingSummary(
            conversation_id=conversation_id,
            summary_text=summary_text,
            summarized_message_ids=to_summarize_ids,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            model_used=self._settings.lightweight_model,
        )
        db.add(summary_record)
        await db.flush()

        result = SummaryResult(
            summary_text=summary_text,
            summarized_message_ids=to_summarize_ids,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            model_used=self._settings.lightweight_model,
        )

        logger.info(
            "Summary complete: %d → %d tokens (saved %d)",
            tokens_before,
            tokens_after,
            tokens_before - tokens_after,
        )

        return new_messages, result

    def _select_messages_to_summarize(
        self,
        messages: list[ChatMessage],
        context_window: int,
        db_ids: list[uuid.UUID],
    ) -> tuple[list[ChatMessage], list[uuid.UUID], list[ChatMessage]]:
        """Select the oldest messages to summarize, respecting exchange atomicity.

        Returns (to_summarize, to_summarize_ids, remaining).

        Exchange grouping rules:
        - messages[0] is the system prompt — always skipped
        - A user message starts a new exchange
        - Existing summary messages (role="system" at index > 0) are their own
          atomic unit (they represent previously summarized content)
        - All messages in an exchange are kept together (atomic)
        - Budget is summary_budget * context_window (default 50%)
        """
        # Slice off system prompt; work with the conversation messages only
        conv_messages = messages[1:]  # parallel to db_ids

        if not conv_messages:
            return [], [], []

        # Group into atomic exchanges
        # Each exchange is a list of (msg, db_id) pairs
        exchanges: list[list[tuple[ChatMessage, uuid.UUID]]] = []
        current: list[tuple[ChatMessage, uuid.UUID]] = []

        for i, msg in enumerate(conv_messages):
            db_id = db_ids[i] if i < len(db_ids) else None
            pair = (msg, db_id)  # type: ignore[arg-type]

            if msg.role == "system":
                # Existing summary — flush current exchange first, then add as its own exchange
                if current:
                    exchanges.append(current)
                    current = []
                exchanges.append([pair])
            elif msg.role == "user":
                # Start of a new exchange — flush current
                if current:
                    exchanges.append(current)
                current = [pair]
            else:
                # Continuation of current exchange (assistant, tool_call, tool_result)
                current.append(pair)

        if current:
            exchanges.append(current)

        if not exchanges:
            return [], [], []

        # Accumulate exchanges from oldest until we'd exceed the budget
        budget = int(self._settings.summary_budget * context_window)
        token_total = 0
        selected_exchange_count = 0

        for exchange in exchanges:
            exchange_msgs = [pair[0] for pair in exchange]
            exchange_tokens = self._token_counter.count_openai(exchange_msgs)

            if selected_exchange_count == 0:
                # Always take at least the first exchange, even if it exceeds budget
                token_total += exchange_tokens
                selected_exchange_count += 1
            elif token_total + exchange_tokens <= budget:
                token_total += exchange_tokens
                selected_exchange_count += 1
            else:
                break

        if selected_exchange_count == 0:
            return [], [], []

        # Split into to_summarize and remaining
        to_summarize_pairs: list[tuple[ChatMessage, uuid.UUID]] = []
        for exchange in exchanges[:selected_exchange_count]:
            to_summarize_pairs.extend(exchange)

        remaining_pairs: list[tuple[ChatMessage, uuid.UUID]] = []
        for exchange in exchanges[selected_exchange_count:]:
            remaining_pairs.extend(exchange)

        to_summarize = [pair[0] for pair in to_summarize_pairs]
        to_summarize_ids = [pair[1] for pair in to_summarize_pairs]
        remaining = [pair[0] for pair in remaining_pairs]

        return to_summarize, to_summarize_ids, remaining

    async def _generate_summary(self, messages: list[ChatMessage]) -> str:
        """Call the lightweight model to produce a concise summary of the given messages."""
        # Build a readable transcript
        lines: list[str] = []
        for msg in messages:
            if msg.role == "system":
                lines.append(f"[Previous summary]: {msg.content or ''}")
            elif msg.role == "user":
                lines.append(f"User: {msg.content or ''}")
            elif msg.role == "assistant":
                lines.append(f"Assistant: {msg.content or ''}")
            elif msg.role == "tool_call":
                lines.append(f"Assistant [tool call]: {msg.tool_name or 'unknown'}")
            elif msg.role == "tool_result":
                lines.append(f"Tool result: {(msg.content or '')[:500]}")  # Truncate long results

        transcript = "\n".join(lines)

        prompt_messages = [
            ChatMessage(
                role="system",
                content=(
                    "You are a conversation summarizer. Produce a concise summary of the "
                    "following conversation, preserving key facts, decisions, preferences, "
                    "and context. Be thorough but avoid unnecessary repetition. "
                    "Write in third person (e.g., 'The user asked about...'). "
                    "Return only the summary text, no preamble."
                ),
            ),
            ChatMessage(
                role="user",
                content=f"Summarize this conversation:\n\n{transcript}",
            ),
        ]

        provider = self._provider_registry.get("openai")
        result = await provider.complete(prompt_messages, self._settings.lightweight_model)
        return result.content.strip()
