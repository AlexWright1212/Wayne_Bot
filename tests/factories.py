import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.models.conversation import Conversation
from src.backend.models.message import Message, MessageRole


async def create_conversation(db: AsyncSession, **overrides) -> Conversation:
    data = {
        "title": "Test Conversation",
        "last_model_id": None,
        "last_provider": None,
    }
    data.update(overrides)
    conv = Conversation(**data)
    db.add(conv)
    await db.flush()
    await db.refresh(conv)
    return conv


async def create_message(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    role: MessageRole = MessageRole.user,
    content: str = "Hello",
    sequence: int = 1,
    **overrides,
) -> Message:
    data = {
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "sequence": sequence,
    }
    data.update(overrides)
    msg = Message(**data)
    db.add(msg)
    await db.flush()
    await db.refresh(msg)
    return msg
