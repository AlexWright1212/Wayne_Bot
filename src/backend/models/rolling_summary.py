import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.backend.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from src.backend.models.conversation import Conversation


class RollingSummary(Base):
    __tablename__ = "rolling_summaries"

    id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    summarized_message_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False
    )
    tokens_before: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_after: Mapped[int] = mapped_column(Integer, nullable=False)
    model_used: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    conversation: Mapped["Conversation"] = relationship("Conversation", back_populates="rolling_summaries")

    __table_args__ = (Index("idx_summaries_conversation", "conversation_id", "created_at"),)
