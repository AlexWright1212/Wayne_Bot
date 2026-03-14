"""Conversation CRUD REST endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.database import get_db
from src.backend.deps import get_conv_service
from src.backend.schemas.conversations import (
    ConversationCreate,
    ConversationDetail,
    ConversationResponse,
    ConversationSummary,
    ConversationUpdate,
)
from src.backend.schemas.messages import MessageResponse
from src.backend.services.conversation import ConversationService

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.post("", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    body: ConversationCreate | None = None,
    db: AsyncSession = Depends(get_db),
    conv_service: ConversationService = Depends(get_conv_service),
) -> ConversationResponse:
    conv = await conv_service.create(db)
    if body and body.title:
        conv = await conv_service.update(conv.id, body.title, db)
    return ConversationResponse.model_validate(conv)


@router.get("", response_model=list[ConversationSummary])
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    conv_service: ConversationService = Depends(get_conv_service),
) -> list[ConversationSummary]:
    convs = await conv_service.list_all(db)
    return [ConversationSummary.model_validate(c) for c in convs]


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    conv_service: ConversationService = Depends(get_conv_service),
) -> ConversationDetail:
    conv = await conv_service.get_with_messages(conversation_id, db)
    return ConversationDetail(
        **ConversationResponse.model_validate(conv).model_dump(),
        messages=[MessageResponse.model_validate(m) for m in conv.messages],
    )


@router.patch("/{conversation_id}", response_model=ConversationResponse)
async def update_conversation(
    conversation_id: uuid.UUID,
    body: ConversationUpdate,
    db: AsyncSession = Depends(get_db),
    conv_service: ConversationService = Depends(get_conv_service),
) -> ConversationResponse:
    conv = await conv_service.update(conversation_id, body.title, db)
    return ConversationResponse.model_validate(conv)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    conv_service: ConversationService = Depends(get_conv_service),
) -> Response:
    await conv_service.delete(conversation_id, db)
    return Response(status_code=204)
