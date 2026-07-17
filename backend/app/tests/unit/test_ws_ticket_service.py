"""Unit tests — Redis-aware WebSocket ticket service."""
import uuid

import pytest

from app.services import ws_ticket_service


@pytest.mark.unit
def test_ws_ticket_issue_and_redeem_once(monkeypatch):
    monkeypatch.setattr("app.core.redis_client.get_redis_client", lambda: None)
    user_id = uuid.uuid4()
    ticket, ttl = ws_ticket_service.issue_ws_ticket(user_id)
    assert ttl == ws_ticket_service.ticket_ttl()
    assert ws_ticket_service.redeem_ws_ticket(ticket) == user_id
    assert ws_ticket_service.redeem_ws_ticket(ticket) is None


@pytest.mark.unit
def test_ws_ticket_rejects_blank():
    assert ws_ticket_service.redeem_ws_ticket("") is None
    assert ws_ticket_service.redeem_ws_ticket("   ") is None


@pytest.mark.unit
def test_ws_ticket_rejects_unknown(monkeypatch):
    monkeypatch.setattr("app.core.redis_client.get_redis_client", lambda: None)
    assert ws_ticket_service.redeem_ws_ticket("unknown-ticket-value") is None


@pytest.mark.unit
def test_ws_ticket_purges_expired_on_issue(monkeypatch):
    monkeypatch.setattr("app.core.redis_client.get_redis_client", lambda: None)
    user_id = uuid.uuid4()
    with ws_ticket_service._lock:
        ws_ticket_service._tickets["stale"] = (user_id, 0.0)
    ws_ticket_service.issue_ws_ticket(user_id)
    with ws_ticket_service._lock:
        assert "stale" not in ws_ticket_service._tickets


@pytest.mark.unit
def test_ws_ticket_redeem_expired_returns_none(monkeypatch):
    monkeypatch.setattr("app.core.redis_client.get_redis_client", lambda: None)
    user_id = uuid.uuid4()
    fixed_now = 1_000_000.0
    monkeypatch.setattr(ws_ticket_service.time, "time", lambda: fixed_now)
    monkeypatch.setattr(ws_ticket_service, "_purge_expired", lambda _now: None)
    ticket = "expired-ticket"
    with ws_ticket_service._lock:
        ws_ticket_service._tickets[ticket] = (user_id, fixed_now - 1)
    assert ws_ticket_service.redeem_ws_ticket(ticket) is None


@pytest.mark.unit
def test_ws_ticket_redis_issue_and_getdel(monkeypatch):
    store: dict[str, str] = {}

    class FakeRedis:
        def setex(self, key, ttl, value):
            store[key] = value

        def getdel(self, key):
            return store.pop(key, None)

    monkeypatch.setattr("app.core.redis_client.get_redis_client", lambda: FakeRedis())
    user_id = uuid.uuid4()
    ticket, _ = ws_ticket_service.issue_ws_ticket(user_id)
    assert store[f"fd:ws:ticket:{ticket}"] == str(user_id)
    assert ws_ticket_service.redeem_ws_ticket(ticket) == user_id
    assert ws_ticket_service.redeem_ws_ticket(ticket) is None


@pytest.mark.unit
def test_ws_ticket_redis_pipeline_fallback(monkeypatch):
    store: dict[str, str] = {}

    class FakePipe:
        def __init__(self):
            self._ops = []

        def get(self, key):
            self._ops.append(("get", key))
            return self

        def delete(self, key):
            self._ops.append(("delete", key))
            return self

        def execute(self):
            results = []
            for op, key in self._ops:
                if op == "get":
                    results.append(store.get(key))
                elif op == "delete":
                    store.pop(key, None)
                    results.append(1)
            return results

    class FakeRedis:
        def setex(self, key, ttl, value):
            store[key] = value

        def pipeline(self):
            return FakePipe()

    client = FakeRedis()
    # no getdel attribute
    monkeypatch.setattr("app.core.redis_client.get_redis_client", lambda: client)
    user_id = uuid.uuid4()
    ticket, _ = ws_ticket_service.issue_ws_ticket(user_id)
    assert ws_ticket_service.redeem_ws_ticket(ticket) == user_id
