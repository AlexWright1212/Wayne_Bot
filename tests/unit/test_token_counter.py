"""Unit tests for TokenCounter.

Focuses on pure logic: openrouter math and openai tiktoken counting.
count_anthropic is a network-call SDK wrapper — not tested here; verify manually.
"""

import math

import tiktoken
import pytest

from src.backend.config import settings
from src.backend.providers.base import ChatMessage
from src.backend.services.token_counter import TokenCounter

tc = TokenCounter(settings)


# ---------------------------------------------------------------------------
# count_openrouter — pure arithmetic, zero dependencies
# ---------------------------------------------------------------------------


def test_count_openrouter_basic():
    msgs = [ChatMessage(role="user", content="Hello")]
    # "Hello" = 5 chars; ceil(5 / 3.5) = 2
    assert tc.count_openrouter(msgs) == math.ceil(5 / 3.5)


def test_count_openrouter_multiple_messages():
    msgs = [
        ChatMessage(role="system", content="You are Wayne."),  # 14 chars
        ChatMessage(role="user", content="Hi there!"),  # 9 chars
        ChatMessage(role="assistant", content="Hello!"),  # 6 chars
    ]
    total_chars = 14 + 9 + 6
    assert tc.count_openrouter(msgs) == math.ceil(total_chars / 3.5)


def test_count_openrouter_none_content():
    # tool_call messages may have None content
    msgs = [
        ChatMessage(role="tool_call", content=None),
        ChatMessage(role="user", content="test"),
    ]
    # None → 0 chars; "test" = 4 chars
    assert tc.count_openrouter(msgs) == math.ceil(4 / 3.5)


def test_count_openrouter_empty():
    assert tc.count_openrouter([]) == 0


# ---------------------------------------------------------------------------
# count_openai — tiktoken-based, local, no API calls
# ---------------------------------------------------------------------------


def test_count_openai_matches_tiktoken():
    """Verify our overhead calculation against manual tiktoken encoding."""
    enc = tiktoken.get_encoding("o200k_base")
    msgs = [
        ChatMessage(role="system", content="You are Wayne."),
        ChatMessage(role="user", content="What is the capital of France?"),
        ChatMessage(role="assistant", content="Paris."),
    ]

    # Manual calculation: 4 overhead per message + content tokens + 3 reply primer
    expected = 3  # reply primer
    for msg in msgs:
        expected += 4  # message overhead
        expected += len(enc.encode(msg.content or ""))

    assert tc.count_openai(msgs) == expected


def test_count_openai_none_content():
    """Messages with None content should not crash and contribute only overhead."""
    msgs = [ChatMessage(role="tool_call", content=None)]
    result = tc.count_openai(msgs)
    # 4 overhead + 0 content tokens + 3 reply primer = 7
    assert result == 7


def test_count_openai_empty():
    # Zero messages: just the 3-token reply primer
    assert tc.count_openai([]) == 3


# ---------------------------------------------------------------------------
# get_context_window — delegates to model catalog
# ---------------------------------------------------------------------------


def test_get_context_window_openai():
    assert tc.get_context_window("gpt-5", "openai") == 400_000


def test_get_context_window_anthropic():
    assert tc.get_context_window("claude-opus-4-6-20250130", "anthropic") == 200_000


def test_get_context_window_unknown():
    # Unknown model returns 0 per model_catalog
    assert tc.get_context_window("unknown-model", "openai") == 0
