import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.backend.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from src.backend.models.message import Message
    from src.backend.models.rolling_summary import RollingSummary


class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = uuid_pk()
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_model_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)

    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.sequence",
    )
    rolling_summaries: Mapped[list["RollingSummary"]] = relationship(
        "RollingSummary",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )

    __table_args__ = (Index("idx_conversations_updated", "updated_at", postgresql_ops={"updated_at": "DESC"}),)
