"""WebSocket connection manager with room-based access scoping.

Rooms:
  user:{user_id}        personal events (notifications, mentions, invites)
  workspace:{id}        workspace-wide events
  project:{id}          project events (tasks, comments, sprints, github)
  channel:{id}          chat channel events

A connection is subscribed to rooms at connect time based on the user's
memberships, so users only ever receive events for resources they can access.
"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._socket_rooms: dict[WebSocket, set[str]] = defaultdict(set)
        self._socket_user: dict[WebSocket, str] = {}
        self._user_sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket, user_id: str, rooms: list[str]) -> bool:
        """Register an accepted websocket. Returns True if user just came online."""
        async with self._lock:
            came_online = len(self._user_sockets[user_id]) == 0
            self._socket_user[ws] = user_id
            self._user_sockets[user_id].add(ws)
            for room in {*rooms, f"user:{user_id}"}:
                self._rooms[room].add(ws)
                self._socket_rooms[ws].add(room)
        return came_online

    async def disconnect(self, ws: WebSocket) -> tuple[str | None, bool]:
        """Unregister a websocket. Returns (user_id, went_offline)."""
        async with self._lock:
            user_id = self._socket_user.pop(ws, None)
            for room in self._socket_rooms.pop(ws, set()):
                self._rooms[room].discard(ws)
                if not self._rooms[room]:
                    self._rooms.pop(room, None)
            went_offline = False
            if user_id:
                self._user_sockets[user_id].discard(ws)
                if not self._user_sockets[user_id]:
                    self._user_sockets.pop(user_id, None)
                    went_offline = True
            return user_id, went_offline

    async def subscribe(self, ws: WebSocket, room: str) -> None:
        async with self._lock:
            self._rooms[room].add(ws)
            self._socket_rooms[ws].add(room)

    def online_user_ids(self) -> list[str]:
        return list(self._user_sockets.keys())

    def is_online(self, user_id: str) -> bool:
        return user_id in self._user_sockets

    async def broadcast(self, room: str, message: dict[str, Any], exclude: WebSocket | None = None) -> None:
        sockets = list(self._rooms.get(room, ()))
        if not sockets:
            return
        data = json.dumps(message, default=str)
        for ws in sockets:
            if ws is exclude:
                continue
            try:
                await ws.send_text(data)
            except Exception:
                # Dead socket; cleanup happens in its reader loop on disconnect.
                pass

    def broadcast_sync(self, rooms: list[str], message: dict[str, Any]) -> None:
        """Thread-safe broadcast for use from sync (threadpool) request handlers."""
        if self._loop is None or self._loop.is_closed():
            return
        seen: set[str] = set()
        for room in rooms:
            if room in seen:
                continue
            seen.add(room)
            asyncio.run_coroutine_threadsafe(self.broadcast(room, message), self._loop)


manager = ConnectionManager()


def emit(event_type: str, rooms: list[str], payload: dict[str, Any] | None = None, **ids: Any) -> None:
    """Emit a realtime event to one or more rooms (callable from sync code).

    Event envelope: {"type": ..., "payload": {...}, plus any scoping ids}
    """
    message: dict[str, Any] = {"type": event_type, "payload": payload or {}}
    for key, value in ids.items():
        if value is not None:
            message[key] = str(value)
    manager.broadcast_sync(rooms, message)
