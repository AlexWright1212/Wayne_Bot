"""Integration tests for the conversation CRUD REST API.

Uses the FastAPI test client with a real test DB (via conftest fixtures).
"""

import pytest


@pytest.mark.asyncio
async def test_create_conversation(client):
    resp = await client.post("/api/conversations")
    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data
    assert data["title"] is None


@pytest.mark.asyncio
async def test_create_conversation_with_title(client):
    resp = await client.post("/api/conversations", json={"title": "My Chat"})
    assert resp.status_code == 201
    assert resp.json()["title"] == "My Chat"


@pytest.mark.asyncio
async def test_list_conversations_empty(client):
    resp = await client.get("/api/conversations")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_conversations_ordered_by_updated_at(client):
    await client.post("/api/conversations", json={"title": "First"})
    await client.post("/api/conversations", json={"title": "Second"})
    resp = await client.get("/api/conversations")
    assert resp.status_code == 200
    convs = resp.json()
    assert len(convs) == 2
    # Most recently created should be first
    assert convs[0]["title"] == "Second"
    assert convs[1]["title"] == "First"


@pytest.mark.asyncio
async def test_get_conversation(client):
    create_resp = await client.post("/api/conversations")
    conv_id = create_resp.json()["id"]

    resp = await client.get(f"/api/conversations/{conv_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == conv_id
    assert data["messages"] == []


@pytest.mark.asyncio
async def test_get_conversation_not_found(client):
    import uuid
    fake_id = str(uuid.uuid4())
    resp = await client.get(f"/api/conversations/{fake_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_rename_conversation(client):
    create_resp = await client.post("/api/conversations")
    conv_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/conversations/{conv_id}", json={"title": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed"


@pytest.mark.asyncio
async def test_delete_conversation(client):
    create_resp = await client.post("/api/conversations")
    conv_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/conversations/{conv_id}")
    assert del_resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/api/conversations/{conv_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_conversation(client):
    import uuid
    resp = await client.delete(f"/api/conversations/{uuid.uuid4()}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_crud_lifecycle(client):
    """Full lifecycle: create → appear in list → get with messages → rename → delete → gone."""
    # Create
    conv_id = (await client.post("/api/conversations")).json()["id"]

    # In list
    convs = (await client.get("/api/conversations")).json()
    assert any(c["id"] == conv_id for c in convs)

    # Get detail (empty messages)
    detail = (await client.get(f"/api/conversations/{conv_id}")).json()
    assert detail["messages"] == []

    # Rename
    (await client.patch(f"/api/conversations/{conv_id}", json={"title": "Final Title"})).json()
    renamed = (await client.get(f"/api/conversations/{conv_id}")).json()
    assert renamed["title"] == "Final Title"

    # Delete
    await client.delete(f"/api/conversations/{conv_id}")
    assert (await client.get(f"/api/conversations/{conv_id}")).status_code == 404
    convs_after = (await client.get("/api/conversations")).json()
    assert not any(c["id"] == conv_id for c in convs_after)
