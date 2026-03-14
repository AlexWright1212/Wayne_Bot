"""Tests for the Anthropic provider implementation."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.backend.exceptions import ProviderError
from src.backend.providers.base import ChatMessage, StreamEvent, ToolCallData
from src.backend.providers.anthropic import AnthropicProvider, _translate_messages


# ---------------------------------------------------------------------------
# Message translation
# ---------------------------------------------------------------------------


class TestTranslateMessages:
    def test_system_extraction(self):
        msgs = [
            ChatMessage(role="system", content="You are Wayne"),
            ChatMessage(role="user", content="Hello"),
        ]
        system, translated = _translate_messages(msgs)
        assert system == "You are Wayne"
        assert len(translated) == 1
        assert translated[0]["role"] == "user"

    def test_multiple_system_messages_concatenated(self):
        msgs = [
            ChatMessage(role="system", content="Part 1"),
            ChatMessage(role="system", content="Part 2"),
            ChatMessage(role="user", content="Hi"),
        ]
        system, translated = _translate_messages(msgs)
        assert system == "Part 1\n\nPart 2"
        assert len(translated) == 1

    def test_tool_call_becomes_assistant_with_tool_use(self):
        msgs = [
            ChatMessage(
                role="tool_call",
                content=None,
                tool_calls=[
                    ToolCallData(id="tu_1", name="web_search", arguments='{"q": "test"}')
                ],
            )
        ]
        _, translated = _translate_messages(msgs)
        assert translated[0]["role"] == "assistant"
        blocks = translated[0]["content"]
        assert any(b["type"] == "tool_use" for b in blocks)
        tool_block = [b for b in blocks if b["type"] == "tool_use"][0]
        assert tool_block["name"] == "web_search"
        assert tool_block["input"] == {"q": "test"}

    def test_tool_result_becomes_user_with_tool_result_block(self):
        msgs = [
            ChatMessage(role="tool_result", content="results here", tool_call_id="tu_1")
        ]
        _, translated = _translate_messages(msgs)
        assert translated[0]["role"] == "user"
        blocks = translated[0]["content"]
        assert blocks[0]["type"] == "tool_result"
        assert blocks[0]["tool_use_id"] == "tu_1"

    def test_consecutive_same_role_merged(self):
        msgs = [
            ChatMessage(role="user", content="first"),
            ChatMessage(role="user", content="second"),
        ]
        _, translated = _translate_messages(msgs)
        assert len(translated) == 1
        assert translated[0]["role"] == "user"
        content = translated[0]["content"]
        assert isinstance(content, list)
        assert len(content) == 2

    def test_no_system_returns_none(self):
        msgs = [ChatMessage(role="user", content="Hello")]
        system, translated = _translate_messages(msgs)
        assert system is None
        assert len(translated) == 1


# ---------------------------------------------------------------------------
# Helpers for stream mocking
# ---------------------------------------------------------------------------


class _AsyncEventIterator:
    """Async iterator over a list of mock stream events."""

    def __init__(self, events):
        self._iter = iter(events)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


def _make_stream_ctx(events, final_message):
    """Build a mock async context manager that simulates Anthropic's messages.stream()."""
    stream = _AsyncEventIterator(events)
    stream.get_final_message = MagicMock(return_value=final_message)

    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=stream)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _make_final_message(stop_reason="end_turn", input_tokens=10, output_tokens=5):
    msg = MagicMock()
    msg.stop_reason = stop_reason
    msg.usage = MagicMock()
    msg.usage.input_tokens = input_tokens
    msg.usage.output_tokens = output_tokens
    return msg


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


class TestStreamChat:
    @pytest.fixture
    def provider(self):
        return AnthropicProvider(api_key="test-key")

    async def test_normal_text_stream(self, provider):
        text_delta_1 = MagicMock(type="content_block_delta")
        text_delta_1.delta = MagicMock(type="text_delta")
        text_delta_1.delta.text = "Hello"

        text_delta_2 = MagicMock(type="content_block_delta")
        text_delta_2.delta = MagicMock(type="text_delta")
        text_delta_2.delta.text = " world"

        stop_event = MagicMock(type="message_stop")
        final_msg = _make_final_message()

        mock_ctx = _make_stream_ctx([text_delta_1, text_delta_2, stop_event], final_msg)

        with patch.object(provider._client.messages, "stream", return_value=mock_ctx):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Hi")], "claude-sonnet-4-6-20250514"
            ):
                events.append(event)

        token_events = [e for e in events if e.type == "token"]
        assert len(token_events) == 2
        assert token_events[0].content == "Hello"

        done_events = [e for e in events if e.type == "done"]
        assert len(done_events) == 1
        assert done_events[0].metadata["finish_reason"] == "end_turn"
        assert done_events[0].metadata["usage"]["prompt_tokens"] == 10

    async def test_thinking_stream(self, provider):
        thinking_delta = MagicMock(type="content_block_delta")
        thinking_delta.delta = MagicMock(type="thinking_delta")
        thinking_delta.delta.thinking = "Let me reason about this..."

        text_delta = MagicMock(type="content_block_delta")
        text_delta.delta = MagicMock(type="text_delta")
        text_delta.delta.text = "Answer"

        stop_event = MagicMock(type="message_stop")
        final_msg = _make_final_message(input_tokens=20, output_tokens=30)

        mock_ctx = _make_stream_ctx([thinking_delta, text_delta, stop_event], final_msg)

        with patch.object(provider._client.messages, "stream", return_value=mock_ctx):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Think hard")],
                "claude-sonnet-4-6-20250514",
                reasoning_level="adaptive",
            ):
                events.append(event)

        reasoning = [e for e in events if e.type == "reasoning"]
        assert len(reasoning) == 1
        assert reasoning[0].content == "Let me reason about this..."

    async def test_tool_use_stream(self, provider):
        block_start = MagicMock(type="content_block_start")
        block_start.content_block = MagicMock(type="tool_use")
        block_start.content_block.id = "tu_abc"
        block_start.content_block.name = "web_search"

        json_delta = MagicMock(type="content_block_delta")
        json_delta.delta = MagicMock(type="input_json_delta")
        json_delta.delta.partial_json = '{"query": "test"}'

        block_stop = MagicMock(type="content_block_stop")
        msg_stop = MagicMock(type="message_stop")

        final_msg = _make_final_message(stop_reason="tool_use")

        mock_ctx = _make_stream_ctx(
            [block_start, json_delta, block_stop, msg_stop], final_msg
        )

        with patch.object(provider._client.messages, "stream", return_value=mock_ctx):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Search")],
                "claude-sonnet-4-6-20250514",
                tools=[{"name": "web_search", "description": "Search", "input_schema": {}}],
            ):
                events.append(event)

        tc_events = [e for e in events if e.type == "tool_call"]
        assert len(tc_events) == 1
        assert tc_events[0].tool_call.id == "tu_abc"
        assert tc_events[0].tool_call.name == "web_search"
        assert tc_events[0].tool_call.arguments == '{"query": "test"}'


# ---------------------------------------------------------------------------
# Complete (non-streaming)
# ---------------------------------------------------------------------------


class TestComplete:
    @pytest.fixture
    def provider(self):
        return AnthropicProvider(api_key="test-key")

    async def test_simple_completion(self, provider):
        mock_text_block = MagicMock()
        mock_text_block.type = "text"
        mock_text_block.text = "The answer is 42"

        mock_response = MagicMock()
        mock_response.content = [mock_text_block]
        mock_response.stop_reason = "end_turn"
        mock_response.usage = MagicMock()
        mock_response.usage.input_tokens = 10
        mock_response.usage.output_tokens = 5

        mock_create = AsyncMock(return_value=mock_response)

        with patch.object(provider._client.messages, "create", mock_create):
            result = await provider.complete(
                [ChatMessage(role="user", content="What is 6*7?")],
                "claude-haiku-4-5-20251001",
            )

        assert result.content == "The answer is 42"
        assert result.tool_calls is None
        assert result.metadata["usage"]["prompt_tokens"] == 10

    async def test_completion_api_error(self, provider):
        import anthropic

        mock_create = AsyncMock(
            side_effect=anthropic.APIError(
                message="overloaded",
                request=MagicMock(),
                body=None,
            )
        )

        with patch.object(provider._client.messages, "create", mock_create):
            with pytest.raises(ProviderError, match="overloaded"):
                await provider.complete(
                    [ChatMessage(role="user", content="Hi")],
                    "claude-sonnet-4-6-20250514",
                )
