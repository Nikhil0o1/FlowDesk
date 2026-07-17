"""WebSocket connection manager with room-based access scoping.

Rooms:
  user:{user_id}        personal events (notifications, mentions, invites)
  workspace:{id}        workspace-wide events
  project:{id}          project events (tasks, comments, sprints, github)
  channel:{id}          chat channel events
  whiteboard:{id}       live whiteboard (opt-in subscribe)

A connection is subscribed to rooms at connect time based on the user's
memberships, so users only ever receive events for resources they can access.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any, Literal

from fastapi import WebSocket

from app.core.config import settings

logger = logging.getLogger(__name__)

WsSource = Literal["app", "integration"]


class ConnectionLimitError(Exception):
    """Raised when a connect would exceed configured caps."""


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._socket_rooms: dict[WebSocket, set[str]] = defaultdict(set)
        self._socket_user: dict[WebSocket, str] = {}
        self._socket_source: dict[WebSocket, WsSource] = {}
        self._socket_token: dict[WebSocket, str] = {}
        self._user_sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self._token_sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def stats(self) -> dict[str, Any]:
        by_source: dict[str, int] = {"app": 0, "integration": 0}
        for src in self._socket_source.values():
            by_source[src] = by_source.get(src, 0) + 1
        return {
            "connections": len(self._socket_user),
            "users_online": len(self._user_sockets),
            "rooms": len(self._rooms),
            "by_source": by_source,
        }

    def _check_caps(
        self,
        user_id: str,
        *,
        source: WsSource,
        token_id: str | None,
    ) -> None:
        user_count = len(self._user_sockets.get(user_id, ()))
        if user_count >= settings.WS_MAX_CONNECTIONS_PER_USER:
            raise ConnectionLimitError("Too many WebSocket connections for this user")

        if source == "integration":
            integ = sum(
                1
                for sock in self._user_sockets.get(user_id, ())
                if self._socket_source.get(sock) == "integration"
            )
            if integ >= settings.WS_MAX_INTEGRATION_CONNECTIONS_PER_USER:
                raise ConnectionLimitError("Too many integration WebSocket connections")
            if token_id:
                tok_count = len(self._token_sockets.get(token_id, ()))
                if tok_count >= settings.WS_MAX_CONNECTIONS_PER_TOKEN:
                    raise ConnectionLimitError("Too many WebSocket connections for this API key")

    async def connect(
        self,
        ws: WebSocket,
        user_id: str,
        rooms: list[str],
        *,
        source: WsSource = "app",
        token_id: str | None = None,
    ) -> bool:
        """Register an accepted websocket. Returns True if user just came online."""
        async with self._lock:
            self._check_caps(user_id, source=source, token_id=token_id)
            came_online = len(self._user_sockets[user_id]) == 0
            self._socket_user[ws] = user_id
            self._socket_source[ws] = source
            self._user_sockets[user_id].add(ws)
            if token_id:
                self._socket_token[ws] = token_id
                self._token_sockets[token_id].add(ws)
            for room in {*rooms, f"user:{user_id}"}:
                self._rooms[room].add(ws)
                self._socket_rooms[ws].add(room)
        return came_online

    async def disconnect(self, ws: WebSocket) -> tuple[str | None, bool]:
        """Unregister a websocket. Returns (user_id, went_offline)."""
        async with self._lock:
            user_id = self._socket_user.pop(ws, None)
            self._socket_source.pop(ws, None)
            token_id = self._socket_token.pop(ws, None)
            if token_id:
                self._token_sockets[token_id].discard(ws)
                if not self._token_sockets[token_id]:
                    self._token_sockets.pop(token_id, None)
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

    async def unsubscribe(self, ws: WebSocket, room: str) -> None:
        async with self._lock:
            self._rooms[room].discard(ws)
            if not self._rooms[room]:
                self._rooms.pop(room, None)
            rooms = self._socket_rooms.get(ws)
            if rooms is not None:
                rooms.discard(room)

    def socket_rooms(self, ws: WebSocket) -> set[str]:
        return set(self._socket_rooms.get(ws, set()))

    def online_user_ids(self) -> list[str]:
        return list(self._user_sockets.keys())

    async def online_user_ids_in_rooms(self, rooms: list[str]) -> list[str]:
        """Online users who share at least one of the given rooms with the caller."""
        async with self._lock:
            seen: set[str] = set()
            for room in rooms:
                for sock in self._rooms.get(room, set()):
                    uid = self._socket_user.get(sock)
                    if uid is not None:
                        seen.add(uid)
            return list(seen)

    def is_online(self, user_id: str) -> bool:
        return user_id in self._user_sockets

    async def broadcast(
        self, room: str, message: dict[str, Any], exclude: WebSocket | None = None
    ) -> None:
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

    With REDIS_URL set, publishes to Redis so every API instance fans out locally.
    Without Redis, broadcasts in-process only.
    """
    message: dict[str, Any] = {"type": event_type, "payload": payload or {}}
    for key, value in ids.items():
        if value is not None:
            message[key] = str(value)

    from app.core.realtime_bus import get_realtime_bus

    bus = get_realtime_bus()
    if bus.enabled and bus.publish(rooms, message):
        return
    manager.broadcast_sync(rooms, message)
