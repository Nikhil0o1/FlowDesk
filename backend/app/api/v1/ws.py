import json
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.security import decode_access_token
from app.core.websocket import manager
from app.db.session import SessionLocal
from app.models.chat import ChatMember
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(tags=["realtime"])


def _resolve_rooms(user: User) -> tuple[list[str], list[str]]:
    """Compute the rooms this user may join. Returns (rooms, workspace_rooms)."""
    db = SessionLocal()
    try:
        perms = PermissionService(db, user)
        workspace_ids = perms.accessible_workspace_ids()
        project_ids = perms.accessible_project_ids()
        channel_ids = db.scalars(
            select(ChatMember.channel_id).where(ChatMember.user_id == user.id)
        ).all()
        ws_rooms = [f"workspace:{wid}" for wid in workspace_ids]
        rooms = (
            ws_rooms
            + [f"project:{pid}" for pid in project_ids]
            + [f"channel:{cid}" for cid in channel_ids]
        )
        return rooms, ws_rooms
    finally:
        db.close()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query(...)):
    payload = decode_access_token(token)
    if payload is None:
        await ws.accept()
        await ws.close(code=4401, reason="Invalid token")
        return
    db = SessionLocal()
    try:
        user = db.get(User, uuid.UUID(payload["sub"]))
        if not user or not user.is_active or user.deleted_at is not None:
            await ws.accept()
            await ws.close(code=4401, reason="Account inactive")
            return
    finally:
        db.close()

    await ws.accept()
    rooms, ws_rooms = _resolve_rooms(user)
    came_online = await manager.connect(ws, str(user.id), rooms)

    if came_online:
        for room in ws_rooms:
            await manager.broadcast(
                room, {"type": "presence.online", "payload": {"user_id": str(user.id)}}
            )
    # Send the currently-online users so the client can seed presence state
    await ws.send_text(
        json.dumps({"type": "presence.state", "payload": {"online_user_ids": manager.online_user_ids()}})
    )

    try:
        while True:
            raw = await ws.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            mtype = message.get("type")

            if mtype == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))

            elif mtype == "chat.typing":
                channel_id = str(message.get("channel_id", ""))
                room = f"channel:{channel_id}"
                # Only forward typing to channels the socket is actually subscribed to
                if room in manager._socket_rooms.get(ws, set()):
                    await manager.broadcast(
                        room,
                        {
                            "type": "chat.typing",
                            "channel_id": channel_id,
                            "payload": {"user_id": str(user.id)},
                        },
                        exclude=ws,
                    )

            elif mtype == "subscribe.channel":
                # Join a channel room created after connect (membership verified)
                channel_id = message.get("channel_id")
                db = SessionLocal()
                try:
                    member = db.scalar(
                        select(ChatMember).where(
                            ChatMember.channel_id == uuid.UUID(str(channel_id)),
                            ChatMember.user_id == user.id,
                        )
                    )
                finally:
                    db.close()
                if member:
                    await manager.subscribe(ws, f"channel:{channel_id}")
    except WebSocketDisconnect:
        pass
    finally:
        user_id, went_offline = await manager.disconnect(ws)
        if user_id and went_offline:
            for room in ws_rooms:
                await manager.broadcast(
                    room, {"type": "presence.offline", "payload": {"user_id": user_id}}
                )
