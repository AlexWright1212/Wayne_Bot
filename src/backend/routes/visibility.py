"""Visibility data REST endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.database import get_db
from src.backend.deps import get_visibility_service
from src.backend.schemas.visibility import TokenCountsResponse, VisibilityResponse
from src.backend.services.visibility import VisibilityService

router = APIRouter(prefix="/api", tags=["visibility"])


@router.get("/messages/{message_id}/visibility", response_model=VisibilityResponse)
async def get_message_visibility(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    visibility_service: VisibilityService = Depends(get_visibility_service),
) -> VisibilityResponse:
    record = await visibility_service.get_visibility(message_id, db)
    if record is None:
        raise HTTPException(status_code=404, detail="Visibility record not found")
    return VisibilityResponse.model_validate(record)


@router.get(
    "/conversations/{conversation_id}/token-counts",
    response_model=TokenCountsResponse,
)
async def get_conversation_token_counts(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    visibility_service: VisibilityService = Depends(get_visibility_service),
) -> TokenCountsResponse:
    record = await visibility_service.get_latest_token_counts(conversation_id, db)
    if record is None:
        raise HTTPException(status_code=404, detail="No visibility data for this conversation")

    utilization: float | None = None
    if record.active_token_count and record.context_window_size:
        utilization = record.active_token_count / record.context_window_size

    return TokenCountsResponse(
        tokens_openai=record.tokens_openai,
        tokens_anthropic=record.tokens_anthropic,
        tokens_openrouter=record.tokens_openrouter,
        output_tokens=record.output_tokens,
        context_window_size=record.context_window_size,
        active_token_count=record.active_token_count,
        utilization=utilization,
    )
