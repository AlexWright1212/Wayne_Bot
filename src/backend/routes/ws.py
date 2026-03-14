"""WebSocket endpoint for streaming LLM responses."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.backend.database import async_session_factory
from src.backend.deps import get_chat_service, get_conv_service
from src.backend.exceptions import ProviderError, ProviderKeyMissing
from src.backend.providers.base import StreamEvent
from src.backend.schemas.ws import WSClientMessage

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


def _translate_event(event: StreamEvent, conversation_id: uuid.UUID) -> dict:
    """Convert a StreamEvent to the WebSocket protocol message (master plan §3.3)."""
    if event.type == "token":
        return {"type": "stream_token", "content": event.content}
    if event.type == "reasoning":
        return {"type": "stream_reasoning", "content": event.content}
    if event.type == "done":
        meta = event.metadata or {}
        return {
            "type": "stream_done",
            "message_id": meta.get("message_id"),
            "visibility_id": meta.get("visibility_id"),  # populated by Unit V
            "token_counts": meta.get("token_counts"),  # populated by Unit V
            "context_utilization": meta.get("context_utilization"),  # populated by Unit V
        }
    if event.type == "error":
        return {"type": "error", "message": event.error or "Unknown error", "recoverable": True}
    # Unrecognized event types pass through as-is for forward-compatibility
    return {"type": event.type, "content": event.content}


@router.websocket("/ws/{conversation_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    conversation_id: uuid.UUID,
) -> None:
    await websocket.accept()

    # Validate conversation exists before entering the receive loop
    conv_service = get_conv_service()
    async with async_session_factory() as db:
        try:
            await conv_service.get(conversation_id, db)
        except Exception:
            await websocket.close(code=1008, reason="Conversation not found")
            return

    chat_service = get_chat_service()

    try:
        while True:
            raw = await websocket.receive_json()
            msg = WSClientMessage.model_validate(raw)

            if msg.type != "send_message":
                continue

            async def on_title_updated(title: str) -> None:
                try:
                    await websocket.send_json(
                        {
                            "type": "title_updated",
                            "conversation_id": str(conversation_id),
                            "title": title,
                        }
                    )
                except Exception:
                    pass  # WS may have closed between title generation and send

            async with async_session_factory() as db:
                try:
                    async for event in chat_service.handle_user_message(
                        conversation_id=conversation_id,
                        content=msg.content,
                        model_id=msg.model_id,
                        provider_name=msg.provider,
                        reasoning_level=msg.reasoning_level,
                        db=db,
                        on_title_updated=on_title_updated,
                    ):
                        ws_msg = _translate_event(event, conversation_id)
                        await websocket.send_json(ws_msg)
                    await db.commit()
                except (ProviderError, ProviderKeyMissing) as exc:
                    await db.rollback()
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": str(exc),
                            "recoverable": True,
                        }
                    )
                except WebSocketDisconnect:
                    await db.rollback()
                    return
                except Exception as exc:
                    await db.rollback()
                    logger.exception("Unexpected error handling WS message")
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Internal server error",
                            "recoverable": True,
                        }
                    )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: conversation %s", conversation_id)
