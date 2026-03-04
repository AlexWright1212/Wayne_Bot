import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.backend.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from src.backend.models.message import Message


class VisibilityRecord(Base):
    __tablename__ = "visibility_records"

    id: Mapped[uuid.UUID] = uuid_pk()
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    request_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    response_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    tokens_openai: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_anthropic: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_openrouter: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    context_window_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    reasoning_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_event: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    tool_trace: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    message: Mapped["Message"] = relationship("Message", back_populates="visibility_record")
