"""WebSocket endpoint for streaming LLM responses."""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.backend.database import async_session_factory
from src.backend.deps import get_chat_service, get_conv_service
from src.backend.exceptions import ProviderError, ProviderKeyMissing
from src.backend.providers.base import StreamEvent
from src.backend.schemas.ws import WSClientMessage
from src.backend.tools.base import ToolStep

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


def _translate_event(event: StreamEvent, conversation_id: uuid.UUID) -> dict | None:
    """Convert a StreamEvent to the WebSocket protocol message (master plan §3.3).

    Returns None for internal events that should NOT be forwarded to the client.
    """
    if event.type == "token":
        return {"type": "stream_token", "content": event.content}

    if event.type == "reasoning":
        return {"type": "stream_reasoning", "content": event.content}

    if event.type == "done":
        meta = event.metadata or {}
        return {
            "type": "stream_done",
            "message_id": meta.get("message_id"),
            "visibility_id": meta.get("visibility_id"),
            "token_counts": meta.get("token_counts"),
            "context_utilization": meta.get("context_utilization"),
        }

    if event.type == "error":
        return {
            "type": "error",
            "message": event.error or "Unknown error",
            "recoverable": True,
        }

    if event.type == "summary_started":
        return {"type": "summary_started"}

    if event.type == "summary_complete":
        return {"type": "summary_complete"}

    if event.type == "tool_call_start":
        tc = event.tool_call
        arguments = {}
        if tc:
            try:
                arguments = json.loads(tc.arguments) if tc.arguments else {}
            except (json.JSONDecodeError, TypeError):
                arguments = {}
        return {
            "type": "tool_call_start",
            "tool_name": tc.name if tc else "",
            "arguments": arguments,
        }

    if event.type == "tool_step":
        meta = event.metadata or {}
        step: ToolStep | None = meta.get("step")
        idx = meta.get("index", 0)
        if step is None:
            return None
        return {
            "type": "tool_step",
            "step_name": step.name,
            "step_index": idx,
            "status": step.status,
            "data": step.data,
            "duration_ms": step.duration_ms,
        }

    if event.type == "_tool_task_ref":
        # Internal event — intercepted by the WS handler, never forwarded
        return None

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

            active_tool_task = None
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
                        # Intercept _tool_task_ref — store locally, don't forward
                        if event.type == "_tool_task_ref":
                            meta = event.metadata or {}
                            active_tool_task = meta.get("task")
                            continue

                        ws_msg = _translate_event(event, conversation_id)
                        if ws_msg is not None:
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
                finally:
                    # Cancel any in-flight tool task on disconnect or error
                    if active_tool_task and not active_tool_task.done():
                        active_tool_task.cancel()

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: conversation %s", conversation_id)
