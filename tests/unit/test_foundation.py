import pytest

from src.backend.config import Settings
from src.backend.models.conversation import Conversation
from src.backend.models.message import Message, MessageRole
from tests.factories import create_conversation, create_message


class TestSettings:
    def test_default_database_url(self):
        s = Settings()
        assert s.database_url == "postgresql+asyncpg://wayne:wayne@localhost:5432/wayne"

    def test_default_lightweight_model(self):
        s = Settings()
        assert s.lightweight_model == "gpt-5-nano"

    def test_default_thresholds(self):
        s = Settings()
        assert s.summary_threshold == 0.80
        assert s.summary_budget == 0.50

    def test_default_cors(self):
        s = Settings()
        assert "http://localhost:5173" in s.cors_origins


class TestDatabaseConnectivity:
    async def test_create_and_query_conversation(self, db_session):
        conv = await create_conversation(db_session, title="Hello World")
        await db_session.commit()

        from sqlalchemy import select
        result = await db_session.execute(select(Conversation).where(Conversation.id == conv.id))
        fetched = result.scalar_one()
        assert fetched.title == "Hello World"
        assert fetched.id == conv.id

    async def test_conversation_timestamps(self, db_session):
        conv = await create_conversation(db_session)
        await db_session.commit()
        assert conv.created_at is not None
        assert conv.updated_at is not None

    async def test_message_creation_with_various_roles(self, db_session):
        conv = await create_conversation(db_session)
        await db_session.commit()

        for i, role in enumerate(MessageRole, start=1):
            msg = await create_message(db_session, conv.id, role=role, sequence=i)
        await db_session.commit()

        from sqlalchemy import select
        result = await db_session.execute(
            select(Message).where(Message.conversation_id == conv.id)
        )
        messages = result.scalars().all()
        assert len(messages) == len(MessageRole)

    async def test_cascade_delete(self, db_session):
        conv = await create_conversation(db_session)
        await create_message(db_session, conv.id, sequence=1)
        await create_message(db_session, conv.id, sequence=2)
        await db_session.commit()

        await db_session.delete(conv)
        await db_session.commit()

        from sqlalchemy import select
        result = await db_session.execute(
            select(Message).where(Message.conversation_id == conv.id)
        )
        assert result.scalars().all() == []


class TestHealthEndpoint:
    async def test_health_returns_ok(self, client):
        response = await client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
