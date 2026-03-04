import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from src.backend.models.message import MessageRole


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: MessageRole
    content: str | None = None
    model_id: str | None = None
    provider: str | None = None
    reasoning_level: str | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    tool_arguments: dict | None = None
    tool_result_call_id: str | None = None
    tool_result_name: str | None = None
    sequence: int
    created_at: datetime
