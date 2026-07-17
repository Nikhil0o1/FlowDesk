"""Coverage — ConnectionManager caps and source tagging."""
import pytest
from unittest.mock import MagicMock

from app.core.websocket import ConnectionLimitError, ConnectionManager


@pytest.mark.unit
@pytest.mark.asyncio
async def test_connection_cap_per_user(monkeypatch):
    monkeypatch.setattr("app.core.websocket.settings.WS_MAX_CONNECTIONS_PER_USER", 2)
    mgr = ConnectionManager()
    a, b, c = MagicMock(), MagicMock(), MagicMock()
    assert await mgr.connect(a, "u1", [], source="app") is True
    assert await mgr.connect(b, "u1", [], source="app") is False
    with pytest.raises(ConnectionLimitError):
        await mgr.connect(c, "u1", [], source="app")
    stats = mgr.stats()
    assert stats["connections"] == 2
    assert stats["by_source"]["app"] == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_integration_token_cap(monkeypatch):
    monkeypatch.setattr("app.core.websocket.settings.WS_MAX_CONNECTIONS_PER_USER", 10)
    monkeypatch.setattr("app.core.websocket.settings.WS_MAX_CONNECTIONS_PER_TOKEN", 1)
    monkeypatch.setattr(
        "app.core.websocket.settings.WS_MAX_INTEGRATION_CONNECTIONS_PER_USER", 10
    )
    mgr = ConnectionManager()
    a, b = MagicMock(), MagicMock()
    await mgr.connect(a, "u1", [], source="integration", token_id="tok")
    with pytest.raises(ConnectionLimitError):
        await mgr.connect(b, "u1", [], source="integration", token_id="tok")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_unsubscribe_removes_room():
    mgr = ConnectionManager()
    ws = MagicMock()
    await mgr.connect(ws, "u1", ["project:1"], source="app")
    await mgr.subscribe(ws, "channel:2")
    assert "channel:2" in mgr.socket_rooms(ws)
    await mgr.unsubscribe(ws, "channel:2")
    assert "channel:2" not in mgr.socket_rooms(ws)
