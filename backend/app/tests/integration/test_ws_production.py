"""Integration — production WebSocket hardening + Integration WS (PAT)."""
from __future__ import annotations

import json

import pytest
from starlette.websockets import WebSocketDisconnect

from app.core.api_token_scopes import SCOPE_PROFILE_READ, SCOPE_REALTIME_READ
from app.services import api_token_service
from app.tests.conftest import auth_headers
from app.tests.helpers import build_project_stack


class _WsDbProxy:
    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def close(self):
        pass


@pytest.fixture
def ws_db(db, monkeypatch):
    monkeypatch.setattr("app.api.v1.ws.SessionLocal", lambda: _WsDbProxy(db))
    monkeypatch.setattr(
        "app.api.v1.integrations_realtime.SessionLocal", lambda: _WsDbProxy(db)
    )
    monkeypatch.setattr("app.core.ws_protocol.SessionLocal", lambda: _WsDbProxy(db))
    return db


@pytest.mark.integration
def test_ws_ticket_jwt_only_pat_denied(client, db, owner):
    headers = auth_headers(client, owner.email)
    raw, _ = api_token_service.create_pat(
        db, user_id=owner.id, name="ws", scopes=[SCOPE_REALTIME_READ]
    )
    db.commit()
    denied = client.post("/api/v1/ws/ticket", headers={"Authorization": f"Bearer {raw}"})
    assert denied.status_code == 403

    ok = client.post("/api/v1/ws/ticket", headers=headers)
    assert ok.status_code == 200


@pytest.mark.integration
def test_app_ws_origin_rejected_in_production(client, owner, ws_db, monkeypatch):
    monkeypatch.setattr("app.api.v1.ws.ws_origin_allowed", lambda _ws: False)
    headers = auth_headers(client, owner.email)
    ticket = client.post("/api/v1/ws/ticket", headers=headers).json()["ticket"]
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/v1/ws?ticket={ticket}") as ws:
            ws.receive_text()
    assert exc.value.code == 4403


@pytest.mark.integration
def test_integration_ws_meta_requires_scope(client, db, owner):
    headers = auth_headers(client, owner.email)
    raw_ok, _ = api_token_service.create_pat(
        db, user_id=owner.id, name="rt", scopes=[SCOPE_REALTIME_READ]
    )
    raw_bad, _ = api_token_service.create_pat(
        db, user_id=owner.id, name="prof", scopes=[SCOPE_PROFILE_READ]
    )
    db.commit()

    assert (
        client.get(
            "/api/v1/integrations/realtime",
            headers={"Authorization": f"Bearer {raw_bad}"},
        ).status_code
        == 403
    )
    meta = client.get(
        "/api/v1/integrations/realtime",
        headers={"Authorization": f"Bearer {raw_ok}"},
    )
    assert meta.status_code == 200
    assert meta.json()["websocket_path"] == "/api/v1/integrations/ws"


@pytest.mark.integration
def test_integration_ws_bearer_ping(client, db, owner, ws_db):
    raw, _ = api_token_service.create_pat(
        db, user_id=owner.id, name="rt2", scopes=[SCOPE_REALTIME_READ]
    )
    db.commit()

    with client.websocket_connect(
        "/api/v1/integrations/ws",
        headers={"Authorization": f"Bearer {raw}"},
    ) as ws:
        connected = json.loads(ws.receive_text())
        assert connected["type"] == "connected"
        assert connected["payload"]["source"] == "integration"
        ws.send_text(json.dumps({"type": "ping"}))
        pong = json.loads(ws.receive_text())
        assert pong["type"] == "pong"


@pytest.mark.integration
def test_integration_ws_auth_message(client, db, owner, ws_db):
    raw, _ = api_token_service.create_pat(
        db, user_id=owner.id, name="rt3", scopes=[SCOPE_REALTIME_READ]
    )
    db.commit()

    with client.websocket_connect("/api/v1/integrations/ws") as ws:
        ws.send_text(json.dumps({"type": "auth", "token": raw}))
        connected = json.loads(ws.receive_text())
        assert connected["type"] == "connected"


@pytest.mark.integration
def test_integration_ws_missing_scope_rejected(client, db, owner, ws_db):
    raw, _ = api_token_service.create_pat(
        db, user_id=owner.id, name="noscope", scopes=[SCOPE_PROFILE_READ]
    )
    db.commit()
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(
            "/api/v1/integrations/ws",
            headers={"Authorization": f"Bearer {raw}"},
        ) as ws:
            ws.receive_text()
    assert exc.value.code == 4401


@pytest.mark.integration
def test_integration_subscribe_acl(client, db, org, owner, ws_db):
    workspace, project = build_project_stack(db, org, owner)
    raw, _ = api_token_service.create_pat(
        db, user_id=owner.id, name="rt4", scopes=[SCOPE_REALTIME_READ]
    )
    db.commit()

    with client.websocket_connect(
        "/api/v1/integrations/ws",
        headers={"Authorization": f"Bearer {raw}"},
    ) as ws:
        ws.receive_text()  # connected
        ws.send_text(
            json.dumps(
                {"type": "subscribe", "resource": "project", "id": str(project.id)}
            )
        )
        sub = json.loads(ws.receive_text())
        assert sub["type"] == "subscribed"
        assert str(project.id) in sub["payload"]["room"]

        fake = "00000000-0000-0000-0000-000000000099"
        ws.send_text(json.dumps({"type": "subscribe", "resource": "project", "id": fake}))
        err = json.loads(ws.receive_text())
        assert err["type"] == "error"
        assert err["payload"]["code"] == "forbidden"


@pytest.mark.integration
def test_app_ws_generic_subscribe(client, db, org, owner, ws_db):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    ticket = client.post("/api/v1/ws/ticket", headers=headers).json()["ticket"]

    with client.websocket_connect(f"/api/v1/ws?ticket={ticket}") as ws:
        ws.receive_text()  # presence
        ws.send_text(
            json.dumps(
                {"type": "subscribe", "resource": "workspace", "id": str(workspace.id)}
            )
        )
        sub = json.loads(ws.receive_text())
        assert sub["type"] == "subscribed"
