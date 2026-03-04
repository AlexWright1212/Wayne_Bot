import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from src.backend.schemas.messages import MessageResponse


class ConversationCreate(BaseModel):
    pass


class ConversationUpdate(BaseModel):
    title: str | None = None


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None = None
    last_model_id: str | None = None
    last_provider: str | None = None
    created_at: datetime
    updated_at: datetime


class ConversationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None = None
    updated_at: datetime


class ConversationDetail(ConversationResponse):
    messages: list[MessageResponse] = []
