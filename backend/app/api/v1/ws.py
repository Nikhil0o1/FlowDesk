"""In-app realtime WebSocket (JWT session ticket path)."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.api.deps import get_current_user_jwt
from app.core.websocket import ConnectionLimitError, manager
from app.core.ws_origin import ws_origin_allowed
from app.core.ws_protocol import resolve_rooms, run_socket_loop
from app.db.session import SessionLocal
from app.models.user import User
from app.services import ws_ticket_service

router = APIRouter(tags=["realtime"])


class WsTicketOut(BaseModel):
    ticket: str
    expires_in: int


@router.post("/ws/ticket", response_model=WsTicketOut)
def create_ws_ticket(user: User = Depends(get_current_user_jwt)):
    """Issue a short-lived, single-use ticket for WebSocket connect (avoids JWT in URL).

    Session JWT only — personal access tokens cannot mint tickets.
    """
    ticket, expires_in = ws_ticket_service.issue_ws_ticket(user.id)
    return WsTicketOut(ticket=ticket, expires_in=expires_in)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, ticket: str = Query(...)):
    if not ws_origin_allowed(ws):
        await ws.accept()
        await ws.close(code=4403, reason="Origin not allowed")
        return

    user_id = ws_ticket_service.redeem_ws_ticket(ticket)
    if user_id is None:
        await ws.accept()
        await ws.close(code=4401, reason="Invalid or expired ticket")
        return

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user or not user.is_active or user.deleted_at is not None:
            await ws.accept()
            await ws.close(code=4401, reason="Account inactive")
            return
    finally:
        db.close()

    await ws.accept()
    rooms, ws_rooms = resolve_rooms(user)
    try:
        came_online = await manager.connect(ws, str(user.id), rooms, source="app")
    except ConnectionLimitError as exc:
        await ws.close(code=4010, reason=str(exc)[:120])
        return

    if came_online:
        for room in ws_rooms:
            await manager.broadcast(
                room,
                {"type": "presence.online", "payload": {"user_id": str(user.id)}},
                exclude=ws,
            )
    await ws.send_text(
        json.dumps(
            {
                "type": "presence.state",
                "payload": {"online_user_ids": await manager.online_user_ids_in_rooms(ws_rooms)},
            }
        )
    )

    try:
        await run_socket_loop(ws, user, allow_collab_relay=True)
    except WebSocketDisconnect:
        pass
    finally:
        user_id_str, went_offline = await manager.disconnect(ws)
        if user_id_str and went_offline:
            for room in ws_rooms:
                await manager.broadcast(
                    room, {"type": "presence.offline", "payload": {"user_id": user_id_str}}
                )
