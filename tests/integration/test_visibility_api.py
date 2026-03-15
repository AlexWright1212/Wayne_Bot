"""Integration tests for visibility API endpoints.

Tests that the GET /api/messages/{id}/visibility and
GET /api/conversations/{id}/token-counts endpoints return correct data.
"""

from __future__ import annotations

import uuid

import pytest

from src.backend.deps import get_visibility_service
from src.backend.models.visibility import VisibilityRecord
from src.backend.services.visibility import VisibilityService
from tests.factories import create_conversation, create_message
from src.backend.models.message import MessageRole


async def _create_visibility_record(db, message_id: uuid.UUID) -> VisibilityRecord:
    """Helper: insert a minimal visibility record directly."""
    record = VisibilityRecord(
        message_id=message_id,
        request_payload={"messages": [], "model_id": "gpt-5", "provider": "openai"},
        response_metadata={"usage": {"completion_tokens": 42}},
        tokens_openai=1000,
        tokens_anthropic=980,
        tokens_openrouter=1050,
        output_tokens=42,
        context_window_size=200_000,
        active_token_count=1000,
        reasoning_content=None,
        summary_event=None,
        tool_trace=None,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return record


class TestGetMessageVisibility:
    async def test_returns_visibility_record(self, client, db_session):
        conv = await create_conversation(db_session)
        msg = await create_message(
            db_session, conv.id, role=MessageRole.assistant, content="Hello"
        )
        await _create_visibility_record(db_session, msg.id)
        await db_session.commit()

        resp = await client.get(f"/api/messages/{msg.id}/visibility")
        assert resp.status_code == 200
        data = resp.json()
        assert data["message_id"] == str(msg.id)
        assert data["tokens_openai"] == 1000
        assert data["tokens_anthropic"] == 980
        assert data["output_tokens"] == 42
        assert data["request_payload"]["model_id"] == "gpt-5"

    async def test_404_for_nonexistent_message(self, client):
        resp = await client.get(f"/api/messages/{uuid.uuid4()}/visibility")
        assert resp.status_code == 404

    async def test_404_for_message_without_visibility(self, client, db_session):
        conv = await create_conversation(db_session)
        msg = await create_message(db_session, conv.id)
        await db_session.commit()

        resp = await client.get(f"/api/messages/{msg.id}/visibility")
        assert resp.status_code == 404


class TestGetConversationTokenCounts:
    async def test_returns_latest_token_counts(self, client, db_session):
        conv = await create_conversation(db_session)
        msg = await create_message(
            db_session, conv.id, role=MessageRole.assistant, sequence=2
        )
        await _create_visibility_record(db_session, msg.id)
        await db_session.commit()

        resp = await client.get(f"/api/conversations/{conv.id}/token-counts")
        assert resp.status_code == 200
        data = resp.json()
        assert data["tokens_openai"] == 1000
        assert data["context_window_size"] == 200_000
        assert data["active_token_count"] == 1000
        # utilization = 1000 / 200000 = 0.005
        assert data["utilization"] == pytest.approx(0.005)

    async def test_404_for_conversation_without_visibility(self, client, db_session):
        conv = await create_conversation(db_session)
        await db_session.commit()

        resp = await client.get(f"/api/conversations/{conv.id}/token-counts")
        assert resp.status_code == 404

    async def test_404_for_nonexistent_conversation(self, client):
        resp = await client.get(f"/api/conversations/{uuid.uuid4()}/token-counts")
        assert resp.status_code == 404
