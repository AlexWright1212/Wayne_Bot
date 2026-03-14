"""Tests for the OpenRouter provider implementation."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx

from src.backend.exceptions import ProviderError
from src.backend.providers.base import ChatMessage, StreamEvent, ToolCallData
from src.backend.providers.openrouter import OpenRouterProvider, _parse_sse_line


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_mock_stream(sse_lines: list[str], status_code: int = 200):
    """Build a mock async context manager that yields SSE lines."""

    async def aiter_lines():
        for line in sse_lines:
            yield line

    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.aiter_lines = aiter_lines
    mock_response.aread = AsyncMock(return_value=b"error body")

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_response)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)
    return mock_ctx


# ---------------------------------------------------------------------------
# SSE line parsing
# ---------------------------------------------------------------------------


class TestParseSSELine:
    def test_data_line(self):
        result = _parse_sse_line('data: {"choices": []}')
        assert result == {"choices": []}

    def test_done_line(self):
        assert _parse_sse_line("data: [DONE]") is None

    def test_empty_line(self):
        assert _parse_sse_line("") is None

    def test_comment_line(self):
        assert _parse_sse_line(": keep-alive") is None

    def test_non_data_line(self):
        assert _parse_sse_line("event: message") is None

    def test_invalid_json(self):
        assert _parse_sse_line("data: {invalid}") is None


# ---------------------------------------------------------------------------
# DeepSeek R1 <think> tag parsing
# ---------------------------------------------------------------------------


class TestThinkTagParsing:
    @pytest.fixture
    def provider(self):
        return OpenRouterProvider(api_key="test-key")

    async def test_think_tags_split_into_reasoning_events(self, provider):
        sse_lines = [
            'data: {"choices":[{"delta":{"content":"<think>reasoning here</think>"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"content":"Final answer"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"},"usage":{"prompt_tokens":5,"completion_tokens":10}]}',
        ]

        with patch.object(provider._client, "stream", return_value=_build_mock_stream(sse_lines)):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Think")],
                "deepseek/deepseek-r1",
            ):
                events.append(event)

        reasoning = [e for e in events if e.type == "reasoning"]
        tokens = [e for e in events if e.type == "token"]

        assert len(reasoning) == 1
        assert reasoning[0].content == "reasoning here"
        assert any(t.content == "Final answer" for t in tokens)

    async def test_think_tags_spanning_multiple_chunks(self, provider):
        sse_lines = [
            'data: {"choices":[{"delta":{"content":"<think>start of"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"content":" reasoning</think>answer"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        ]

        with patch.object(provider._client, "stream", return_value=_build_mock_stream(sse_lines)):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Think")],
                "deepseek/deepseek-r1",
            ):
                events.append(event)

        reasoning = [e for e in events if e.type == "reasoning"]
        tokens = [e for e in events if e.type == "token"]

        reasoning_text = "".join(e.content for e in reasoning)
        assert reasoning_text == "start of reasoning"
        assert any(t.content == "answer" for t in tokens)

    async def test_no_think_tags(self, provider):
        sse_lines = [
            'data: {"choices":[{"delta":{"content":"Just text"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        ]

        with patch.object(provider._client, "stream", return_value=_build_mock_stream(sse_lines)):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Hi")],
                "deepseek/deepseek-v3.2",
            ):
                events.append(event)

        reasoning = [e for e in events if e.type == "reasoning"]
        assert len(reasoning) == 0

        tokens = [e for e in events if e.type == "token"]
        assert tokens[0].content == "Just text"


# ---------------------------------------------------------------------------
# Tool call streaming
# ---------------------------------------------------------------------------


class TestToolCallStream:
    @pytest.fixture
    def provider(self):
        return OpenRouterProvider(api_key="test-key")

    async def test_tool_call_accumulated(self, provider):
        sse_lines = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"web_search","arguments":""}}]},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\": \\"test\\"}"}}]},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        ]

        with patch.object(provider._client, "stream", return_value=_build_mock_stream(sse_lines)):
            events = []
            async for event in provider.stream_chat(
                [ChatMessage(role="user", content="Search")],
                "deepseek/deepseek-v3.2",
                tools=[{"type": "function", "function": {"name": "web_search"}}],
            ):
                events.append(event)

        tc_events = [e for e in events if e.type == "tool_call"]
        assert len(tc_events) == 1
        assert tc_events[0].tool_call.id == "call_1"
        assert tc_events[0].tool_call.name == "web_search"


# ---------------------------------------------------------------------------
# Stream error handling
# ---------------------------------------------------------------------------


class TestStreamErrors:
    @pytest.fixture
    def provider(self):
        return OpenRouterProvider(api_key="test-key")

    async def test_non_200_status_raises(self, provider):
        mock_ctx = _build_mock_stream([], status_code=429)

        with patch.object(provider._client, "stream", return_value=mock_ctx):
            with pytest.raises(ProviderError, match="OpenRouter API error"):
                async for _ in provider.stream_chat(
                    [ChatMessage(role="user", content="Hi")],
                    "deepseek/deepseek-v3.2",
                ):
                    pass


# ---------------------------------------------------------------------------
# Complete (non-streaming)
# ---------------------------------------------------------------------------


class TestComplete:
    @pytest.fixture
    def provider(self):
        return OpenRouterProvider(api_key="test-key")

    async def test_simple_completion(self, provider):
        mock_json = {
            "choices": [
                {
                    "message": {"content": "The answer is 42", "tool_calls": None},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = mock_json
        mock_response.text = json.dumps(mock_json)

        with patch.object(provider._client, "post", AsyncMock(return_value=mock_response)):
            result = await provider.complete(
                [ChatMessage(role="user", content="What is 6*7?")],
                "deepseek/deepseek-v3.2",
            )

        assert result.content == "The answer is 42"
        assert result.tool_calls is None
        assert result.metadata["usage"]["prompt_tokens"] == 10

    async def test_http_error_raises_provider_error(self, provider):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"

        with patch.object(provider._client, "post", AsyncMock(return_value=mock_response)):
            with pytest.raises(ProviderError, match="OpenRouter API error"):
                await provider.complete(
                    [ChatMessage(role="user", content="Hi")],
                    "deepseek/deepseek-v3.2",
                )

    async def test_network_error_raises_provider_error(self, provider):
        with patch.object(
            provider._client,
            "post",
            AsyncMock(side_effect=httpx.ConnectError("connection refused")),
        ):
            with pytest.raises(ProviderError, match="OpenRouter HTTP error"):
                await provider.complete(
                    [ChatMessage(role="user", content="Hi")],
                    "deepseek/deepseek-v3.2",
                )


# ---------------------------------------------------------------------------
# Model catalog and registry tests
# ---------------------------------------------------------------------------


class TestModelCatalog:
    def test_static_models_exist(self):
        from src.backend.providers.model_catalog import get_static_models

        models = get_static_models()
        assert "gpt-5" in models
        assert "gpt-5-nano" in models
        assert "claude-sonnet-4-6-20250514" in models
        assert len(models) == 7

    def test_context_window_lookup(self):
        from src.backend.providers.model_catalog import get_context_window

        assert get_context_window("gpt-5", "openai") == 400_000
        assert get_context_window("claude-opus-4-6-20250130", "anthropic") == 200_000
        assert get_context_window("unknown-model", "openai") == 0

    def test_get_all_models_grouped(self):
        from src.backend.providers.model_catalog import get_all_models

        groups = get_all_models()
        assert "openai" in groups
        assert "anthropic" in groups
        assert "openrouter" in groups
        assert len(groups["openai"]) == 4
        assert len(groups["anthropic"]) == 3

    async def test_fetch_openrouter_models(self):
        from src.backend.providers.model_catalog import fetch_openrouter_models

        mock_data = {
            "data": [
                {
                    "id": "deepseek/deepseek-r1",
                    "name": "DeepSeek R1",
                    "context_length": 128000,
                    "top_provider": {"max_completion_tokens": 8192},
                    "architecture": {"tool_use": True},
                },
                {
                    "id": "deepseek/deepseek-v3.2",
                    "name": "DeepSeek V3.2",
                    "context_length": 128000,
                    "top_provider": {"max_completion_tokens": 8192},
                    "architecture": {},
                },
            ]
        }

        with patch("src.backend.providers.model_catalog.httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.json.return_value = mock_data
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            models = await fetch_openrouter_models("test-key")

        assert len(models) == 2
        r1 = [m for m in models if "r1" in m.id][0]
        assert r1.supports_reasoning is True
        assert r1.reasoning_type == "builtin"
        assert r1.context_window == 128000


class TestProviderRegistry:
    def test_available_providers_with_keys(self):
        from src.backend.providers.registry import ProviderRegistry

        mock_settings = MagicMock()
        mock_settings.openai_api_key = "sk-test"
        mock_settings.anthropic_api_key = ""
        mock_settings.openrouter_api_key = "sk-or-test"

        registry = ProviderRegistry(mock_settings)
        available = registry.available_providers()
        assert "openai" in available
        assert "anthropic" not in available
        assert "openrouter" in available

    def test_get_missing_provider_raises(self):
        from src.backend.providers.registry import ProviderRegistry

        mock_settings = MagicMock()
        mock_settings.openai_api_key = ""
        mock_settings.anthropic_api_key = ""
        mock_settings.openrouter_api_key = ""

        registry = ProviderRegistry(mock_settings)
        with pytest.raises(Exception, match="not configured"):
            registry.get("openai")

    def test_get_configured_provider(self):
        from src.backend.providers.registry import ProviderRegistry
        from src.backend.providers.openai import OpenAIProvider

        mock_settings = MagicMock()
        mock_settings.openai_api_key = "sk-test"
        mock_settings.anthropic_api_key = ""
        mock_settings.openrouter_api_key = ""

        registry = ProviderRegistry(mock_settings)
        provider = registry.get("openai")
        assert isinstance(provider, OpenAIProvider)
