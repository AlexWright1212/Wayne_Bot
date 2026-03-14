"""WebSocket message schemas.

Client → Server messages use WSClientMessage (Pydantic).
Server → Client messages are plain dicts matching the protocol in master plan §3.3.
"""

from __future__ import annotations

from pydantic import BaseModel


class WSClientMessage(BaseModel):
    """Message sent from the browser to the server over WebSocket."""

    type: str  # "send_message"
    content: str
    model_id: str
    provider: str
    reasoning_level: str | None = None
