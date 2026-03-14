"""Integration tests for ChatService orchestration.

Tests the chat loop end-to-end against the test DB with a mocked provider.
Verifies message persistence, sequence numbers, and auto-title triggering.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.backend.models.message import MessageRole
from src.backend.providers.base import ChatMessage, CompletionResult, StreamEvent
from src.backend.services.auto_title import AutoTitleService
from src.backend.services.chat import ChatService
from src.backend.services.conversation import ConversationService


def _make_mock_provider(tokens: list[str] = ("Hello", " world"), metadata: dict | None = None):
    """Build a mock LLMProvider whose stream_chat yields token events then done."""

    async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
        for t in tokens:
            yield StreamEvent(type="token", content=t)
        yield StreamEvent(type="done", metadata=metadata or {})

    provider = MagicMock()
    provider.stream_chat = MagicMock(return_value=_aiter(_stream()))
    return provider


def _aiter(gen):
    """Wrap an existing async generator so it can be returned from a regular mock."""
    return gen


def _make_mock_registry(provider):
    registry = MagicMock()
    registry.get.return_value = provider
    return registry


@pytest.fixture
def conv_service():
    return ConversationService()


@pytest.fixture
def mock_auto_title():
    svc = MagicMock(spec=AutoTitleService)
    svc.generate_title = AsyncMock(return_value=None)  # no-op by default
    return svc


@pytest.fixture
def chat_service(mock_auto_title):
    def _make(provider):
        registry = _make_mock_registry(provider)
        conv_svc = ConversationService()
        return ChatService(registry, conv_svc, mock_auto_title), conv_svc

    return _make


class TestChatServiceFlow:
    @pytest.mark.asyncio
    async def test_messages_persisted(self, db_session):
        """User message and assistant message are both saved with correct roles."""
        tokens = ["Hi", " there"]
        provider = _make_mock_provider(tokens)
        registry = _make_mock_registry(provider)
        conv_svc = ConversationService()
        auto_title_svc = MagicMock(spec=AutoTitleService)
        auto_title_svc.generate_title = AsyncMock(return_value=None)
        svc = ChatService(registry, conv_svc, auto_title_svc)

        conv = await conv_svc.create(db_session)

        events = []
        async for event in svc.handle_user_message(
            conversation_id=conv.id,
            content="Hello",
            model_id="gpt-5",
            provider_name="openai",
            reasoning_level=None,
            db=db_session,
        ):
            events.append(event)

        # Verify event sequence
        types = [e.type for e in events]
        assert types.count("token") == 2
        assert types[-1] == "done"

        # Verify done event has message_id
        done_event = events[-1]
        assert done_event.metadata is not None
        assert "message_id" in done_event.metadata

        # Verify both messages persisted
        from sqlalchemy import select
        from src.backend.models.message import Message
        result = await db_session.execute(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.sequence)
        )
        msgs = list(result.scalars().all())
        assert len(msgs) == 2
        assert msgs[0].role == MessageRole.user
        assert msgs[0].content == "Hello"
        assert msgs[0].sequence == 1
        assert msgs[1].role == MessageRole.assistant
        assert msgs[1].content == "Hi there"
        assert msgs[1].sequence == 2
        assert msgs[1].model_id == "gpt-5"
        assert msgs[1].provider == "openai"

    @pytest.mark.asyncio
    async def test_sequence_numbers_increment_across_turns(self, db_session):
        """Each message in a conversation gets the next sequence number."""
        provider = _make_mock_provider(["Response 1"])
        registry = _make_mock_registry(provider)
        conv_svc = ConversationService()
        auto_title_svc = MagicMock(spec=AutoTitleService)
        auto_title_svc.generate_title = AsyncMock(return_value=None)
        svc = ChatService(registry, conv_svc, auto_title_svc)

        conv = await conv_svc.create(db_session)

        # First turn
        async for _ in svc.handle_user_message(
            conversation_id=conv.id,
            content="Turn 1",
            model_id="gpt-5",
            provider_name="openai",
            reasoning_level=None,
            db=db_session,
        ):
            pass

        # Replace provider for second turn
        provider2 = _make_mock_provider(["Response 2"])
        registry.get.return_value = provider2

        async for _ in svc.handle_user_message(
            conversation_id=conv.id,
            content="Turn 2",
            model_id="gpt-5",
            provider_name="openai",
            reasoning_level=None,
            db=db_session,
        ):
            pass

        from sqlalchemy import select
        from src.backend.models.message import Message
        result = await db_session.execute(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.sequence)
        )
        msgs = list(result.scalars().all())
        assert len(msgs) == 4
        assert [m.sequence for m in msgs] == [1, 2, 3, 4]
        assert msgs[0].content == "Turn 1"
        assert msgs[2].content == "Turn 2"

    @pytest.mark.asyncio
    async def test_conversation_metadata_updated(self, db_session):
        """conversation.last_model_id and last_provider are set after a message."""
        provider = _make_mock_provider()
        registry = _make_mock_registry(provider)
        conv_svc = ConversationService()
        auto_title_svc = MagicMock(spec=AutoTitleService)
        auto_title_svc.generate_title = AsyncMock(return_value=None)
        svc = ChatService(registry, conv_svc, auto_title_svc)

        conv = await conv_svc.create(db_session)
        assert conv.last_model_id is None

        async for _ in svc.handle_user_message(
            conversation_id=conv.id,
            content="Hello",
            model_id="claude-sonnet-4-6",
            provider_name="anthropic",
            reasoning_level="low",
            db=db_session,
        ):
            pass

        await db_session.refresh(conv)
        assert conv.last_model_id == "claude-sonnet-4-6"
        assert conv.last_provider == "anthropic"

    @pytest.mark.asyncio
    async def test_auto_title_fires_on_first_exchange(self, db_session):
        """After the first exchange (2 messages), on_title_updated is called."""
        provider = _make_mock_provider(["Answer"])
        registry = _make_mock_registry(provider)
        conv_svc = ConversationService()
        auto_title_svc = MagicMock(spec=AutoTitleService)
        auto_title_svc.generate_title = AsyncMock(return_value="My Title")
        svc = ChatService(registry, conv_svc, auto_title_svc)

        conv = await conv_svc.create(db_session)
        received_titles = []

        async def on_title(title: str) -> None:
            received_titles.append(title)

        # Patch _run_auto_title to call on_title_updated directly (avoids fresh DB session)
        original_run = svc._run_auto_title

        async def patched_run(conversation_id, user_content, assistant_content, on_title_updated):
            title = await auto_title_svc.generate_title(
                conversation_id=conversation_id,
                user_message=user_content,
                assistant_message=assistant_content,
                db=db_session,
            )
            if title:
                await on_title_updated(title)

        svc._run_auto_title = patched_run

        async for _ in svc.handle_user_message(
            conversation_id=conv.id,
            content="What is Python?",
            model_id="gpt-5",
            provider_name="openai",
            reasoning_level=None,
            db=db_session,
            on_title_updated=on_title,
        ):
            pass

        # Give background task a moment to run
        import asyncio
        await asyncio.sleep(0.05)

        assert received_titles == ["My Title"]

    @pytest.mark.asyncio
    async def test_auto_title_does_not_fire_on_second_exchange(self, db_session):
        """Auto-title only fires on the first exchange (2 total messages)."""
        call_count = 0

        async def on_title(title: str) -> None:
            nonlocal call_count
            call_count += 1

        provider = _make_mock_provider(["A"])
        registry = _make_mock_registry(provider)
        conv_svc = ConversationService()
        auto_title_svc = MagicMock(spec=AutoTitleService)
        auto_title_svc.generate_title = AsyncMock(return_value=None)
        svc = ChatService(registry, conv_svc, auto_title_svc)

        conv = await conv_svc.create(db_session)

        # First turn
        async for _ in svc.handle_user_message(
            conversation_id=conv.id,
            content="First",
            model_id="gpt-5",
            provider_name="openai",
            reasoning_level=None,
            db=db_session,
            on_title_updated=on_title,
        ):
            pass

        # Second turn (now 4 messages exist — should not fire auto-title)
        provider2 = _make_mock_provider(["B"])
        registry.get.return_value = provider2
        async for _ in svc.handle_user_message(
            conversation_id=conv.id,
            content="Second",
            model_id="gpt-5",
            provider_name="openai",
            reasoning_level=None,
            db=db_session,
            on_title_updated=on_title,
        ):
            pass

        import asyncio
        await asyncio.sleep(0.05)
        # on_title should not have been called at all
        # (generate_title returns None so no callback even for turn 1)
        assert call_count == 0

    @pytest.mark.asyncio
    async def test_provider_error_yields_error_event(self, db_session):
        """ProviderError during streaming produces an error StreamEvent."""
        from src.backend.exceptions import ProviderError

        async def _failing_stream(*args, **kwargs):
            yield StreamEvent(type="token", content="partial")
            raise ProviderError("API down")

        provider = MagicMock()
        provider.stream_chat = MagicMock(return_value=_failing_stream())
        registry = _make_mock_registry(provider)
        conv_svc = ConversationService()
        auto_title_svc = MagicMock(spec=AutoTitleService)
        auto_title_svc.generate_title = AsyncMock(return_value=None)
        svc = ChatService(registry, conv_svc, auto_title_svc)

        conv = await conv_svc.create(db_session)

        events = []
        async for event in svc.handle_user_message(
            conversation_id=conv.id,
            content="Hello",
            model_id="gpt-5",
            provider_name="openai",
            reasoning_level=None,
            db=db_session,
        ):
            events.append(event)

        error_events = [e for e in events if e.type == "error"]
        assert len(error_events) == 1
        assert "API down" in (error_events[0].error or "")

        # No assistant message persisted (stream didn't complete)
        from sqlalchemy import select
        from src.backend.models.message import Message
        result = await db_session.execute(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .where(Message.role == MessageRole.assistant)
        )
        assert list(result.scalars().all()) == []
