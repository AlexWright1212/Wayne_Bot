"""Integration smoke tests for frontend–backend wiring.

Covers the nine spec-required paths from spec/v1-wiring-spec.md.
Run as a group:

    poetry run pytest tests/integration/test_api_wiring.py

The WebSocket test (test 7) uses starlette's synchronous TestClient with
mocked provider/chat dependencies so no real LLM API key is required.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from src.backend.main import app
from src.backend.models.message import MessageRole
from src.backend.models.visibility import VisibilityRecord
from src.backend.providers.base import StreamEvent
from tests.factories import create_conversation, create_message

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _insert_visibility(db, message_id: uuid.UUID) -> VisibilityRecord:
    record = VisibilityRecord(
        message_id=message_id,
        request_payload={"messages": [], "model_id": "gpt-5", "provider": "openai"},
        response_metadata={"usage": {"completion_tokens": 10}},
        tokens_openai=1000,
        tokens_anthropic=980,
        output_tokens=10,
        context_window_size=200_000,
        active_token_count=1000,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# Test 1: GET /api/health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health_check(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# Test 2: POST /api/conversations → GET /api/conversations → appears in list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_and_list_conversation(client):
    resp = await client.post("/api/conversations", json={"title": "Wiring Test"})
    assert resp.status_code == 201
    conv_id = resp.json()["id"]
    assert conv_id

    list_resp = await client.get("/api/conversations")
    assert list_resp.status_code == 200
    ids = [c["id"] for c in list_resp.json()]
    assert conv_id in ids


# ---------------------------------------------------------------------------
# Test 3: GET /api/conversations/{id} returns message history
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_conversation_with_messages(client, db_session):
    conv = await create_conversation(db_session)
    await create_message(db_session, conv.id, role=MessageRole.user, content="Hi", sequence=1)
    await create_message(
        db_session, conv.id, role=MessageRole.assistant, content="Hello!", sequence=2
    )
    await db_session.commit()

    resp = await client.get(f"/api/conversations/{conv.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == str(conv.id)
    assert len(data["messages"]) == 2
    assert data["messages"][0]["content"] == "Hi"
    assert data["messages"][1]["content"] == "Hello!"


# ---------------------------------------------------------------------------
# Test 4: DELETE /api/conversations/{id} removes and cascades
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_conversation_cascades(client):
    conv_id = (await client.post("/api/conversations")).json()["id"]

    del_resp = await client.delete(f"/api/conversations/{conv_id}")
    assert del_resp.status_code == 204

    get_resp = await client.get(f"/api/conversations/{conv_id}")
    assert get_resp.status_code == 404

    list_resp = await client.get("/api/conversations")
    assert not any(c["id"] == conv_id for c in list_resp.json())


# ---------------------------------------------------------------------------
# Test 5: PATCH /api/conversations/{id} updates title
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_conversation_title(client):
    conv_id = (await client.post("/api/conversations")).json()["id"]

    patch_resp = await client.patch(
        f"/api/conversations/{conv_id}", json={"title": "Renamed via PATCH"}
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["title"] == "Renamed via PATCH"

    get_resp = await client.get(f"/api/conversations/{conv_id}")
    assert get_resp.json()["title"] == "Renamed via PATCH"


# ---------------------------------------------------------------------------
# Test 6: GET /api/models returns non-empty catalog grouped by provider
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_models_returns_catalog(client):
    resp = await client.get("/api/models")
    assert resp.status_code == 200
    data = resp.json()

    # Response has a "providers" dict
    assert "providers" in data
    providers = data["providers"]
    assert isinstance(providers, dict)
    assert len(providers) > 0

    # At least one provider has models
    total_models = sum(len(p["models"]) for p in providers.values())
    assert total_models > 0, "GET /api/models must return at least one model"


# ---------------------------------------------------------------------------
# Test 7: WebSocket /ws/{conversation_id} — stream_token then stream_done
# (sync test using starlette TestClient; provider is fully mocked)
# ---------------------------------------------------------------------------


def test_websocket_streaming():
    conv_id = uuid.uuid4()

    # Mock conv_service: get() succeeds without touching the DB
    mock_conv_service = MagicMock()
    mock_conv_service.get = AsyncMock(return_value=MagicMock(id=conv_id))

    # Mock chat_service: handle_user_message yields token → done
    async def _fake_stream(*args, **kwargs):
        yield StreamEvent(type="token", content="Hello")
        yield StreamEvent(
            type="done",
            metadata={
                "message_id": str(uuid.uuid4()),
                "visibility_id": str(uuid.uuid4()),
                "token_counts": {"tokens_openai": 10},
                "context_utilization": 0.01,
            },
        )

    mock_chat_service = MagicMock()
    mock_chat_service.handle_user_message = MagicMock(return_value=_fake_stream())

    # Mock async_session_factory as an async context manager
    mock_db = AsyncMock()
    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_db)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_factory = MagicMock(return_value=mock_ctx)

    with (
        patch("src.backend.routes.ws.get_conv_service", return_value=mock_conv_service),
        patch("src.backend.routes.ws.get_chat_service", return_value=mock_chat_service),
        patch("src.backend.routes.ws.async_session_factory", mock_factory),
    ):
        with TestClient(app) as test_client:
            with test_client.websocket_connect(f"/ws/{conv_id}") as ws:
                ws.send_json(
                    {
                        "type": "send_message",
                        "content": "Hello",
                        "model_id": "claude-sonnet-4-6",
                        "provider": "anthropic",
                        "reasoning_level": None,
                    }
                )

                received: list[dict] = []
                for _ in range(20):
                    msg = ws.receive_json()
                    received.append(msg)
                    if msg["type"] == "stream_done":
                        break

    types = [m["type"] for m in received]
    assert "stream_token" in types, f"Expected stream_token in {types}"
    assert "stream_done" in types, f"Expected stream_done in {types}"

    token_msgs = [m for m in received if m["type"] == "stream_token"]
    assert token_msgs[0]["content"] == "Hello"

    done_msg = next(m for m in received if m["type"] == "stream_done")
    assert done_msg["message_id"] is not None


# ---------------------------------------------------------------------------
# Test 8: GET /api/messages/{message_id}/visibility after a completed exchange
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_message_visibility(client, db_session):
    conv = await create_conversation(db_session)
    msg = await create_message(
        db_session, conv.id, role=MessageRole.assistant, content="Answer", sequence=2
    )
    await _insert_visibility(db_session, msg.id)
    await db_session.commit()

    resp = await client.get(f"/api/messages/{msg.id}/visibility")
    assert resp.status_code == 200
    data = resp.json()
    assert data["message_id"] == str(msg.id)
    assert data["tokens_openai"] == 1000
    assert data["output_tokens"] == 10
    assert "request_payload" in data


# ---------------------------------------------------------------------------
# Test 9: GET /api/conversations/{id}/token-counts after a completed exchange
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_conversation_token_counts(client, db_session):
    conv = await create_conversation(db_session)
    msg = await create_message(
        db_session, conv.id, role=MessageRole.assistant, content="Answer", sequence=2
    )
    await _insert_visibility(db_session, msg.id)
    await db_session.commit()

    resp = await client.get(f"/api/conversations/{conv.id}/token-counts")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tokens_openai"] == 1000
    assert data["context_window_size"] == 200_000
    assert data["active_token_count"] == 1000
    assert data["utilization"] == pytest.approx(0.005)
