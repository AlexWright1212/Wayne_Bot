"""Tests for the OpenAI provider implementation."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.backend.exceptions import ProviderError
from src.backend.providers.base import ChatMessage, StreamEvent, ToolCallData
from src.backend.providers.openai import OpenAIProvider, _translate_messages


# ---------------------------------------------------------------------------
# Message translation
# ---------------------------------------------------------------------------


class TestTranslateMessages:
    def test_simple_messages(self):
        msgs = [
            ChatMessage(role="system", content="You are helpful"),
            ChatMessage(role="user", content="Hello"),
            ChatMessage(role="assistant", content="Hi there"),
        ]
        result = _translate_messages(msgs)
        assert result == [
            {"role": "system", "content": "You are helpful"},
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]

    def test_tool_call_message(self):
        msgs = [
            ChatMessage(
                role="tool_call",
                content=None,
                tool_calls=[
                    ToolCallData(id="tc_1", name="web_search", arguments='{"query": "test"}')
                ],
            )
        ]
        result = _translate_messages(msgs)
        assert result[0]["role"] == "assistant"
        assert result[0]["tool_calls"][0]["id"] == "tc_1"
        assert result[0]["tool_calls"][0]["function"]["name"] == "web_search"

    def test_tool_result_message(self):
        msgs = [
            ChatMessage(role="tool_result", content="search results", tool_call_id="tc_1")
        ]
        result = _translate_messages(msgs)
        assert result[0]["role"] == "tool"
        assert result[0]["tool_call_id"] == "tc_1"
        assert result[0]["content"] == "search results"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_chunk(content=None, finish_reason=None, tool_calls=None, reasoning=None, usage=None):
    """Build a mock streaming chunk."""
    delta = MagicMock()
    delta.content = content
    delta.tool_calls = tool_calls

    if reasoning:
        delta.reasoning = MagicMock()
        delta.reasoning.content = reasoning
    else:
        delta.reasoning = None

    choice = MagicMock()
    choice.delta = delta
    choice.finish_reason = finish_reason

    chunk = MagicMock()
    chunk.choices = [choice]
    chunk.usage = usage
    return chunk


class _AsyncChunkIterator:
    """An async iterator over a list of chunks."""

    def __init__(self, chunks):
        self._iter = iter(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


class TestStreamChat:
    @pytest.fixture
    def provider(self):
        return OpenAIProvider(api_key="test-key")

    async def test_normal_text_stream(self, provider):
        chunks = [
            _make_chunk(content="Hello"),
            _make_chunk(content=" world"),
            _make_chunk(finish_reason="stop"),
        ]
        mock_create = AsyncMock(return_value=_AsyncChunkIterator(chunks))

        with patch.object(provider._client.chat.completions, "create", mock_create):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Hi")], "gpt-5"
            ):
                events.append(event)

        token_events = [e for e in events if e.type == "token"]
        assert len(token_events) == 2
        assert token_events[0].content == "Hello"
        assert token_events[1].content == " world"

        done_events = [e for e in events if e.type == "done"]
        assert len(done_events) == 1
        assert done_events[0].metadata["finish_reason"] == "stop"

    async def test_reasoning_stream(self, provider):
        chunks = [
            _make_chunk(reasoning="Let me think..."),
            _make_chunk(content="The answer is 42"),
            _make_chunk(finish_reason="stop"),
        ]
        mock_create = AsyncMock(return_value=_AsyncChunkIterator(chunks))

        with patch.object(provider._client.chat.completions, "create", mock_create):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Hi")], "gpt-5", reasoning_level="medium"
            ):
                events.append(event)

        reasoning_events = [e for e in events if e.type == "reasoning"]
        assert len(reasoning_events) == 1
        assert reasoning_events[0].content == "Let me think..."

    async def test_tool_call_stream(self, provider):
        tc_delta_1 = MagicMock()
        tc_delta_1.index = 0
        tc_delta_1.id = "call_123"
        tc_delta_1.function = MagicMock()
        tc_delta_1.function.name = "web_search"
        tc_delta_1.function.arguments = '{"query":'

        tc_delta_2 = MagicMock()
        tc_delta_2.index = 0
        tc_delta_2.id = None
        tc_delta_2.function = MagicMock()
        tc_delta_2.function.name = None
        tc_delta_2.function.arguments = ' "test"}'

        chunks = [
            _make_chunk(tool_calls=[tc_delta_1]),
            _make_chunk(tool_calls=[tc_delta_2]),
            _make_chunk(finish_reason="tool_calls"),
        ]
        mock_create = AsyncMock(return_value=_AsyncChunkIterator(chunks))

        with patch.object(provider._client.chat.completions, "create", mock_create):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Search for test")],
                "gpt-5",
                tools=[{"type": "function", "function": {"name": "web_search"}}],
            ):
                events.append(event)

        tc_events = [e for e in events if e.type == "tool_call"]
        assert len(tc_events) == 1
        assert tc_events[0].tool_call.id == "call_123"
        assert tc_events[0].tool_call.name == "web_search"
        assert tc_events[0].tool_call.arguments == '{"query": "test"}'

    async def test_api_error_raises_provider_error(self, provider):
        import openai

        mock_create = AsyncMock(
            side_effect=openai.APIError(
                message="rate limit exceeded",
                request=MagicMock(),
                body=None,
            )
        )

        with patch.object(provider._client.chat.completions, "create", mock_create):
            with pytest.raises(ProviderError, match="rate limit exceeded"):
                async for _ in provider.stream_chat(
                    [ChatMessage(role="user", content="Hi")], "gpt-5"
                ):
                    pass


# ---------------------------------------------------------------------------
# Complete (non-streaming)
# ---------------------------------------------------------------------------


class TestComplete:
    @pytest.fixture
    def provider(self):
        return OpenAIProvider(api_key="test-key")

    async def test_simple_completion(self, provider):
        mock_message = MagicMock()
        mock_message.content = "The answer is 42"
        mock_message.tool_calls = None

        mock_usage = MagicMock()
        mock_usage.prompt_tokens = 10
        mock_usage.completion_tokens = 5

        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_choice.finish_reason = "stop"

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.usage = mock_usage

        mock_create = AsyncMock(return_value=mock_response)

        with patch.object(provider._client.chat.completions, "create", mock_create):
            result = await provider.complete(
                [ChatMessage(role="user", content="What is 6*7?")], "gpt-5-nano"
            )

        assert result.content == "The answer is 42"
        assert result.tool_calls is None
        assert result.metadata["finish_reason"] == "stop"
        assert result.metadata["usage"]["prompt_tokens"] == 10

    async def test_completion_with_tool_calls(self, provider):
        mock_tc = MagicMock()
        mock_tc.id = "call_abc"
        mock_tc.function = MagicMock()
        mock_tc.function.name = "web_search"
        mock_tc.function.arguments = '{"query": "test"}'

        mock_message = MagicMock()
        mock_message.content = None
        mock_message.tool_calls = [mock_tc]

        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_choice.finish_reason = "tool_calls"

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.usage = None

        mock_create = AsyncMock(return_value=mock_response)

        with patch.object(provider._client.chat.completions, "create", mock_create):
            result = await provider.complete(
                [ChatMessage(role="user", content="Search")], "gpt-5"
            )

        assert result.content == ""
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0].name == "web_search"

    async def test_completion_api_error(self, provider):
        import openai

        mock_create = AsyncMock(
            side_effect=openai.APIError(
                message="server error",
                request=MagicMock(),
                body=None,
            )
        )

        with patch.object(provider._client.chat.completions, "create", mock_create):
            with pytest.raises(ProviderError, match="server error"):
                await provider.complete(
                    [ChatMessage(role="user", content="Hi")], "gpt-5"
                )
