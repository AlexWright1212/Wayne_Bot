import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.backend.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from src.backend.models.conversation import Conversation
    from src.backend.models.visibility import VisibilityRecord


class MessageRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"
    system = "system"
    tool_call = "tool_call"
    tool_result = "tool_result"
    summary = "summary"


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[MessageRole] = mapped_column(
        Enum(MessageRole, name="message_role"), nullable=False
    )
    content: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Model attribution (assistant messages)
    model_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reasoning_level: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Tool call fields (role = tool_call)
    tool_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tool_arguments: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Tool result fields (role = tool_result)
    tool_result_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tool_result_name: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Ordering
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    conversation: Mapped["Conversation"] = relationship("Conversation", back_populates="messages")
    visibility_record: Mapped["VisibilityRecord | None"] = relationship(
        "VisibilityRecord",
        back_populates="message",
        uselist=False,
        cascade="all, delete-orphan",
    )

    __table_args__ = (Index("idx_messages_conversation", "conversation_id", "sequence"),)
