"""Unit tests — WebSocket connection manager."""
import asyncio
import json

import pytest
from starlette.websockets import WebSocketState

from app.core.websocket import ConnectionManager, emit


class _FakeWebSocket:
    def __init__(self):
        self.client_state = WebSocketState.CONNECTED
        self.sent: list[str] = []

    async def send_text(self, data: str):
        self.sent.append(data)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_connection_manager_connect_disconnect():
    mgr = ConnectionManager()
    ws = _FakeWebSocket()
    came = await mgr.connect(ws, "user-1", ["workspace:1"])
    assert came is True
    assert mgr.is_online("user-1")

    await mgr.subscribe(ws, "channel:abc")
    uid, offline = await mgr.disconnect(ws)
    assert uid == "user-1"
    assert offline is True
    assert not mgr.is_online("user-1")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_connection_manager_broadcast_and_presence():
    mgr = ConnectionManager()
    ws1 = _FakeWebSocket()
    ws2 = _FakeWebSocket()
    await mgr.connect(ws1, "u1", ["workspace:1"])
    await mgr.connect(ws2, "u2", ["workspace:1"])

    online = await mgr.online_user_ids_in_rooms(["workspace:1"])
    assert set(online) == {"u1", "u2"}

    await mgr.broadcast("workspace:1", {"type": "test.event"}, exclude=ws1)
    assert ws1.sent == []
    assert len(ws2.sent) == 1
    assert json.loads(ws2.sent[0])["type"] == "test.event"


@pytest.mark.unit
def test_emit_without_redis(monkeypatch):
    loop = asyncio.new_event_loop()
    mgr = ConnectionManager()
    mgr.set_loop(loop)
    monkeypatch.setattr("app.core.websocket.manager", mgr)
    monkeypatch.setattr("app.core.realtime_bus.get_realtime_bus", lambda: type("B", (), {"enabled": False, "publish": lambda *a, **k: False})())

    ws = _FakeWebSocket()
    loop.run_until_complete(mgr.connect(ws, "u1", ["project:1"]))
    emit("task.updated", ["project:1"], {"title": "X"}, task_id="abc")
    loop.run_until_complete(asyncio.sleep(0.05))
    assert any("task.updated" in s for s in ws.sent)
    loop.close()
