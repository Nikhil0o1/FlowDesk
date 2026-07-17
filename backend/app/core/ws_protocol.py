"""Shared WebSocket protocol helpers (rate limits, subscribe ACL, message loop)."""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from fastapi import HTTPException, WebSocket
from sqlalchemy import select

from app.core.config import settings
from app.core.websocket import manager
from app.db.session import SessionLocal
from app.models.chat import ChatMember
from app.models.document import Document
from app.models.user import User
from app.models.whiteboard import Whiteboard
from app.services import doc_service
from app.services.permission_service import PermissionError403, PermissionService

WS_MSG_MAX_BYTES = 1_048_576
WS_RATE_PER_SEC = 60.0
WS_BURST = 120
WS_MAX_VIOLATIONS = 200


class InboundRateLimiter:
    def __init__(self) -> None:
        self.tokens = float(WS_BURST)
        self.last_refill = time.monotonic()
        self.violations = 0

    def allow(self, raw: str) -> bool:
        """Return True if the frame should be processed; False to drop."""
        now = time.monotonic()
        self.tokens = min(float(WS_BURST), self.tokens + (now - self.last_refill) * WS_RATE_PER_SEC)
        self.last_refill = now
        if len(raw) > WS_MSG_MAX_BYTES or self.tokens < 1.0:
            self.violations += 1
            return False
        self.tokens -= 1.0
        if self.violations:
            self.violations -= 1
        return True

    @property
    def should_close(self) -> bool:
        return self.violations > WS_MAX_VIOLATIONS


def resolve_rooms(user: User) -> tuple[list[str], list[str]]:
    """Compute default rooms. Returns (rooms, workspace_rooms)."""
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


async def _can_join_room(user: User, resource: str, resource_id: str) -> bool:
    db = SessionLocal()
    try:
        perms = PermissionService(db, user)
        rid = uuid.UUID(str(resource_id))
        if resource == "workspace":
            return rid in set(perms.accessible_workspace_ids())
        if resource == "project":
            try:
                perms.require_project_view(rid)
                return True
            except Exception:
                return False
        if resource == "channel":
            member = db.scalar(
                select(ChatMember).where(
                    ChatMember.channel_id == rid,
                    ChatMember.user_id == user.id,
                )
            )
            return member is not None
        if resource == "whiteboard":
            board = db.get(Whiteboard, rid)
            if not board or board.deleted_at is not None:
                return False
            try:
                if board.project_id is not None:
                    perms.require_project_view(board.project_id)
                elif board.created_by != user.id:
                    perms.require_workspace_admin(board.workspace_id)
                return True
            except Exception:
                return False
        if resource == "document":
            doc = db.get(Document, rid)
            if not doc or doc.deleted_at is not None:
                return False
            try:
                doc_service.require_doc_view(db, perms, doc)
                return True
            except (PermissionError403, HTTPException, ValueError, TypeError):
                return False
            except Exception:
                return False
        return False
    finally:
        db.close()


async def handle_client_message(
    ws: WebSocket,
    user: User,
    message: dict[str, Any],
    *,
    allow_collab_relay: bool,
) -> None:
    """Process one parsed client→server message."""
    mtype = message.get("type")

    if mtype == "ping":
        await ws.send_text(json.dumps({"type": "pong"}))
        return

    if mtype == "ack":
        await ws.send_text(
            json.dumps({"type": "ack", "payload": {"id": message.get("id")}})
        )
        return

    if mtype in ("subscribe", "unsubscribe"):
        resource = str(message.get("resource") or "").strip().lower()
        resource_id = message.get("id") or message.get(f"{resource}_id")
        if resource not in ("workspace", "project", "channel", "whiteboard") or not resource_id:
            await ws.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "payload": {
                            "code": "bad_subscribe",
                            "message": "resource and id required",
                        },
                    }
                )
            )
            return
        room = f"{resource}:{resource_id}"
        if mtype == "subscribe":
            if await _can_join_room(user, resource, str(resource_id)):
                await manager.subscribe(ws, room)
                await ws.send_text(
                    json.dumps({"type": "subscribed", "payload": {"room": room}})
                )
            else:
                await ws.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "payload": {
                                "code": "forbidden",
                                "message": "Not allowed to subscribe to this room",
                            },
                        }
                    )
                )
        else:
            await manager.unsubscribe(ws, room)
            await ws.send_text(
                json.dumps({"type": "unsubscribed", "payload": {"room": room}})
            )
        return

    if not allow_collab_relay:
        return

    if mtype == "chat.typing":
        channel_id = str(message.get("channel_id", ""))
        room = f"channel:{channel_id}"
        if room in manager.socket_rooms(ws):
            await manager.broadcast(
                room,
                {
                    "type": "chat.typing",
                    "channel_id": channel_id,
                    "payload": {"user_id": str(user.id)},
                },
                exclude=ws,
            )
        return

    if mtype == "subscribe.channel":
        channel_id = message.get("channel_id")
        if channel_id and await _can_join_room(user, "channel", str(channel_id)):
            await manager.subscribe(ws, f"channel:{channel_id}")
        return

    if mtype == "whiteboard.subscribe":
        wid = message.get("whiteboard_id")
        if wid and await _can_join_room(user, "whiteboard", str(wid)):
            await manager.subscribe(ws, f"whiteboard:{wid}")
        return

    if mtype in ("whiteboard.cursor", "whiteboard.scene"):
        wid = str(message.get("whiteboard_id", ""))
        room = f"whiteboard:{wid}"
        if room in manager.socket_rooms(ws):
            await manager.broadcast(
                room,
                {
                    "type": mtype,
                    "whiteboard_id": wid,
                    "payload": {**(message.get("payload") or {}), "user_id": str(user.id)},
                },
                exclude=ws,
            )
        return

    if mtype == "doc.subscribe":
        did = message.get("document_id")
        if did and await _can_join_room(user, "document", str(did)):
            room = f"document:{did}"
            await manager.subscribe(ws, room)
            await manager.broadcast(
                room,
                {
                    "type": "doc.presence",
                    "document_id": str(did),
                    "payload": {
                        "user_id": str(user.id),
                        "action": "join",
                        **(message.get("payload") or {}),
                    },
                },
                exclude=ws,
            )
        return

    if mtype in ("doc.content", "doc.cursor", "doc.presence"):
        did = str(message.get("document_id", ""))
        room = f"document:{did}"
        if room in manager.socket_rooms(ws):
            await manager.broadcast(
                room,
                {
                    "type": mtype,
                    "document_id": did,
                    "payload": {**(message.get("payload") or {}), "user_id": str(user.id)},
                },
                exclude=ws,
            )


async def run_socket_loop(
    ws: WebSocket,
    user: User,
    *,
    allow_collab_relay: bool,
) -> None:
    """Read frames until disconnect; enforce rate limits and idle timeout."""
    limiter = InboundRateLimiter()
    idle = float(settings.WS_IDLE_TIMEOUT_SECONDS)
    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=idle)
            except asyncio.TimeoutError:
                await ws.close(code=4000, reason="Idle timeout")
                break

            if not limiter.allow(raw):
                if limiter.should_close:
                    await ws.close(code=4008, reason="Rate limit exceeded")
                    break
                continue

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(message, dict):
                continue
            await handle_client_message(
                ws, user, message, allow_collab_relay=allow_collab_relay
            )
    except Exception:
        # WebSocketDisconnect and transport errors end the loop
        pass
