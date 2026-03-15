"""Tests for RollingSummaryService.

Focuses on:
  - _select_messages_to_summarize: exchange grouping logic (pure, no DB)
  - Threshold detection (below/above)
  - Integration test: full check_and_summarize with real DB rows
"""

from __future__ import annotations

import uuid
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.config import settings
from src.backend.models.message import MessageRole
from src.backend.models.rolling_summary import RollingSummary
from src.backend.providers.base import ChatMessage, CompletionResult
from src.backend.services.rolling_summary import RollingSummaryService, SummaryResult
from src.backend.services.token_counter import TokenCounter
from tests.factories import create_conversation, create_message


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SYSTEM = ChatMessage(role="system", content="You are Wayne.")
WINDOW = 10_000  # Small window for easy threshold arithmetic

# IDs for testing — enough to cover all test cases
_ids = [uuid.uuid4() for _ in range(20)]


def make_service(token_count: int = 9000) -> tuple[RollingSummaryService, MagicMock, MagicMock]:
    """Return (service, mock_token_counter, mock_registry)."""
    mock_tc = MagicMock(spec=TokenCounter)
    mock_tc.count_for_provider = AsyncMock(return_value=token_count)
    mock_tc.count_openai = MagicMock(return_value=100)  # per-exchange estimate
    mock_tc.get_context_window = MagicMock(return_value=WINDOW)

    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(
        return_value=CompletionResult(content="Summary of the conversation.")
    )

    mock_registry = MagicMock()
    mock_registry.get = MagicMock(return_value=mock_provider)

    svc = RollingSummaryService(mock_tc, mock_registry, settings)
    return svc, mock_tc, mock_registry


# ---------------------------------------------------------------------------
# _select_messages_to_summarize — pure logic, no DB needed
# ---------------------------------------------------------------------------


def test_select_simple_alternating():
    """Simple user/assistant conversation: first exchange selected."""
    svc, _, _ = make_service()
    # count_openai returns 100 per call; budget = 0.5 * 10_000 = 5_000
    # Each exchange is 100 tokens, so many fit in budget
    # Force a tight budget by overriding count_openai
    svc._token_counter.count_openai = MagicMock(return_value=3000)

    messages = [
        SYSTEM,
        ChatMessage(role="user", content="First question"),
        ChatMessage(role="assistant", content="First answer"),
        ChatMessage(role="user", content="Second question"),
        ChatMessage(role="assistant", content="Second answer"),
    ]
    ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]

    to_summarize, summarize_ids, remaining = svc._select_messages_to_summarize(
        messages, WINDOW, ids
    )

    # With 3000 tokens per exchange and budget of 5000, exactly one exchange fits
    assert len(to_summarize) == 2  # user + assistant
    assert to_summarize[0].role == "user"
    assert to_summarize[1].role == "assistant"
    assert len(remaining) == 2  # second exchange


def test_select_tool_call_exchange_is_atomic():
    """A tool-call sequence must never be split across summarize/remaining."""
    svc, _, _ = make_service()
    # Make each exchange cost 3000 tokens so budget (5000) only fits one
    svc._token_counter.count_openai = MagicMock(return_value=3000)

    messages = [
        SYSTEM,
        # Exchange 1: user + tool_call + tool_result + assistant
        ChatMessage(role="user", content="Search for something"),
        ChatMessage(role="tool_call", content=None),
        ChatMessage(role="tool_result", content="search results"),
        ChatMessage(role="assistant", content="Here is what I found"),
        # Exchange 2: plain user/assistant
        ChatMessage(role="user", content="Follow-up question"),
        ChatMessage(role="assistant", content="Follow-up answer"),
    ]
    ids = [uuid.uuid4() for _ in range(6)]

    to_summarize, _, remaining = svc._select_messages_to_summarize(messages, WINDOW, ids)

    # First exchange (4 messages) should be selected atomically
    assert len(to_summarize) == 4
    assert to_summarize[0].role == "user"
    assert to_summarize[1].role == "tool_call"
    assert to_summarize[2].role == "tool_result"
    assert to_summarize[3].role == "assistant"
    # Second exchange stays in remaining
    assert len(remaining) == 2


def test_select_existing_summary_is_own_exchange():
    """An existing summary message at index 1 forms its own exchange group."""
    svc, _, _ = make_service()
    svc._token_counter.count_openai = MagicMock(return_value=3000)

    existing_summary = ChatMessage(role="system", content="[Conversation summary]\nOld stuff.")
    messages = [
        SYSTEM,
        existing_summary,  # index 1 — existing summary from previous compression
        ChatMessage(role="user", content="New question"),
        ChatMessage(role="assistant", content="New answer"),
    ]
    ids = [uuid.uuid4() for _ in range(3)]

    to_summarize, _, remaining = svc._select_messages_to_summarize(messages, WINDOW, ids)

    # The existing summary exchange (1 message) fits in budget (3000 <= 5000)
    # The second exchange (2 messages) would also fit (3000 + 3000 = 6000 > 5000), so stop at 1
    # Actually 3000 <= 5000 for first exchange, then 3000 + 3000 = 6000 > 5000 for second
    assert len(to_summarize) == 1
    assert to_summarize[0].content == existing_summary.content
    assert len(remaining) == 2  # new user/assistant stays


def test_select_single_oversized_exchange_still_selected():
    """If even one exchange exceeds the budget, it's still selected (never return empty)."""
    svc, _, _ = make_service()
    # Exchange is huge — 8000 tokens, budget is 5000
    svc._token_counter.count_openai = MagicMock(return_value=8000)

    messages = [
        SYSTEM,
        ChatMessage(role="user", content="A very long message"),
        ChatMessage(role="assistant", content="A very long response"),
        ChatMessage(role="user", content="Another question"),
        ChatMessage(role="assistant", content="Another answer"),
    ]
    ids = [uuid.uuid4() for _ in range(4)]

    to_summarize, _, remaining = svc._select_messages_to_summarize(messages, WINDOW, ids)

    # Even though first exchange (8000 tokens) exceeds budget (5000), it must be selected
    assert len(to_summarize) == 2
    assert len(remaining) == 2


def test_select_budget_boundary():
    """Last exchange that fits is included; next is excluded."""
    svc, _, _ = make_service()
    # Each exchange = 2000 tokens; budget = 5000; so 2 fit (4000), 3rd would be 6000 > 5000
    svc._token_counter.count_openai = MagicMock(return_value=2000)

    messages = [
        SYSTEM,
        ChatMessage(role="user", content="Q1"),
        ChatMessage(role="assistant", content="A1"),
        ChatMessage(role="user", content="Q2"),
        ChatMessage(role="assistant", content="A2"),
        ChatMessage(role="user", content="Q3"),
        ChatMessage(role="assistant", content="A3"),
    ]
    ids = [uuid.uuid4() for _ in range(6)]

    to_summarize, _, remaining = svc._select_messages_to_summarize(messages, WINDOW, ids)

    assert len(to_summarize) == 4  # 2 exchanges × 2 messages
    assert len(remaining) == 2     # 1 exchange remaining


# ---------------------------------------------------------------------------
# Threshold detection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_summary_below_threshold():
    """Below threshold → returns original messages and None."""
    svc, mock_tc, _ = make_service(token_count=7900)  # below 80% of 10_000

    messages = [SYSTEM, ChatMessage(role="user", content="Hi")]
    result_msgs, result = await svc.check_and_summarize(
        uuid.uuid4(), messages, "gpt-5", "openai", MagicMock()
    )

    assert result is None
    assert result_msgs is messages


@pytest.mark.asyncio
async def test_summary_triggers_at_threshold():
    """At exactly 80% of context window → summary triggers."""
    svc, mock_tc, _ = make_service(token_count=8000)  # exactly 80% of 10_000
    mock_tc.count_openai = MagicMock(return_value=100)

    messages = [
        SYSTEM,
        ChatMessage(role="user", content="Question"),
        ChatMessage(role="assistant", content="Answer"),
    ]

    # Mock the DB calls
    db = AsyncMock(spec=AsyncSession)
    db.execute = AsyncMock()
    db.flush = AsyncMock()

    # Simulate DB returning message IDs
    id_mock = MagicMock()
    id_mock.scalars.return_value.all.return_value = [uuid.uuid4(), uuid.uuid4()]
    seq_mock = MagicMock()
    seq_mock.scalar_one_or_none.return_value = 2

    db.execute.side_effect = [id_mock, seq_mock]

    result_msgs, result = await svc.check_and_summarize(
        uuid.uuid4(), messages, "gpt-5", "openai", db
    )

    assert result is not None
    assert isinstance(result, SummaryResult)
    assert result.summary_text == "Summary of the conversation."


# ---------------------------------------------------------------------------
# Integration test — real DB
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_integration_check_and_summarize(db_session: AsyncSession):
    """Full check_and_summarize with real DB: creates RollingSummary and summary Message."""
    conv = await create_conversation(db_session)
    msg1 = await create_message(
        db_session, conv.id, role=MessageRole.user, content="What is Python?", sequence=1
    )
    msg2 = await create_message(
        db_session, conv.id, role=MessageRole.assistant, content="Python is a programming language.", sequence=2
    )
    msg3 = await create_message(
        db_session, conv.id, role=MessageRole.user, content="What is FastAPI?", sequence=3
    )
    msg4 = await create_message(
        db_session, conv.id, role=MessageRole.assistant, content="FastAPI is a web framework.", sequence=4
    )

    messages = [
        SYSTEM,
        ChatMessage(role="user", content=msg1.content),
        ChatMessage(role="assistant", content=msg2.content),
        ChatMessage(role="user", content=msg3.content),
        ChatMessage(role="assistant", content=msg4.content),
    ]

    # Build service with mocked token counter (above threshold) and mocked OpenAI provider
    mock_tc = MagicMock(spec=TokenCounter)
    mock_tc.count_for_provider = AsyncMock(side_effect=[9000, 3000])  # before, after
    mock_tc.count_openai = MagicMock(return_value=200)   # per-exchange
    mock_tc.get_context_window = MagicMock(return_value=WINDOW)

    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(
        return_value=CompletionResult(content="Python is a language. FastAPI is a framework.")
    )
    mock_registry = MagicMock()
    mock_registry.get = MagicMock(return_value=mock_provider)

    svc = RollingSummaryService(mock_tc, mock_registry, settings)

    new_messages, result = await svc.check_and_summarize(
        conv.id, messages, "gpt-5", "openai", db_session
    )

    # SummaryResult is returned
    assert result is not None
    assert result.tokens_before == 9000
    assert result.tokens_after == 3000
    assert result.model_used == settings.lightweight_model
    assert len(result.summarized_message_ids) > 0

    # New messages list has correct structure
    assert new_messages[0].role == "system"  # original system prompt
    assert new_messages[1].role == "system"  # new summary message
    assert "[Conversation summary]" in (new_messages[1].content or "")

    # RollingSummary row was persisted
    from sqlalchemy import select
    from src.backend.models.rolling_summary import RollingSummary as RS
    rs_result = await db_session.execute(
        select(RS).where(RS.conversation_id == conv.id)
    )
    rs = rs_result.scalar_one_or_none()
    assert rs is not None
    assert rs.tokens_before == 9000
    assert rs.tokens_after == 3000

    # Summary message was persisted with role=summary
    from src.backend.models.message import Message
    msg_result = await db_session.execute(
        select(Message)
        .where(Message.conversation_id == conv.id, Message.role == MessageRole.summary)
    )
    summary_msg = msg_result.scalar_one_or_none()
    assert summary_msg is not None
    assert "[Conversation summary]" in (summary_msg.content or "")
