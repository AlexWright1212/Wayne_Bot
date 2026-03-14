"""Unit tests for ConversationService message conversion logic.

Focuses on _to_chat_message() which is pure logic with edge cases —
the highest-value thing to test in this module.
"""

import json
import uuid
from types import SimpleNamespace

import pytest

from src.backend.models.message import MessageRole
from src.backend.providers.base import ChatMessage
from src.backend.services.conversation import ConversationService

svc = ConversationService()


def make_message(**kwargs) -> SimpleNamespace:
    """Create a plain-object stand-in for a Message ORM row.

    _to_chat_message() only reads attributes, so SimpleNamespace works without
    needing a live DB session or SQLAlchemy mapper initialization.
    """
    defaults = {
        "id": uuid.uuid4(),
        "conversation_id": uuid.uuid4(),
        "role": MessageRole.user,
        "content": "hello",
        "sequence": 1,
        "model_id": None,
        "provider": None,
        "reasoning_level": None,
        "tool_call_id": None,
        "tool_name": None,
        "tool_arguments": None,
        "tool_result_call_id": None,
        "tool_result_name": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


class TestToChatMessage:
    def test_user_message(self):
        msg = make_message(role=MessageRole.user, content="hello there")
        result = svc._to_chat_message(msg)
        assert result == ChatMessage(role="user", content="hello there")

    def test_assistant_message(self):
        msg = make_message(role=MessageRole.assistant, content="I can help")
        result = svc._to_chat_message(msg)
        assert result == ChatMessage(role="assistant", content="I can help")

    def test_system_message(self):
        msg = make_message(role=MessageRole.system, content="You are Wayne")
        result = svc._to_chat_message(msg)
        assert result == ChatMessage(role="system", content="You are Wayne")

    def test_summary_becomes_system(self):
        """Summary-role messages inject as system messages for context window."""
        msg = make_message(
            role=MessageRole.summary,
            content="Previously: user asked about Python; assistant explained basics.",
        )
        result = svc._to_chat_message(msg)
        assert result.role == "system"
        assert "Python" in (result.content or "")

    def test_tool_call_message(self):
        """tool_call role → assistant message with tool_calls list."""
        msg = make_message(
            role=MessageRole.tool_call,
            content=None,
            tool_call_id="call_abc123",
            tool_name="web_search",
            tool_arguments={"query": "latest news", "reason": "user asked"},
        )
        result = svc._to_chat_message(msg)
        assert result.role == "assistant"
        assert result.tool_calls is not None
        assert len(result.tool_calls) == 1
        tc = result.tool_calls[0]
        assert tc.id == "call_abc123"
        assert tc.name == "web_search"
        # Arguments should be valid JSON
        parsed = json.loads(tc.arguments)
        assert parsed["query"] == "latest news"

    def test_tool_call_with_none_tool_arguments(self):
        """tool_arguments=None should not raise — serializes as empty dict."""
        msg = make_message(
            role=MessageRole.tool_call,
            tool_call_id="call_xyz",
            tool_name="web_search",
            tool_arguments=None,
        )
        result = svc._to_chat_message(msg)
        assert result.role == "assistant"
        assert result.tool_calls is not None
        parsed = json.loads(result.tool_calls[0].arguments)
        assert parsed == {}

    def test_tool_result_message(self):
        """tool_result role maps directly with link back to call id."""
        msg = make_message(
            role=MessageRole.tool_result,
            content='{"results": []}',
            tool_result_call_id="call_abc123",
            tool_result_name="web_search",
        )
        result = svc._to_chat_message(msg)
        assert result.role == "tool_result"
        assert result.content == '{"results": []}'
        assert result.tool_call_id == "call_abc123"
        assert result.tool_name == "web_search"
