"""Integration — WebSocket handshake and message handlers (SessionLocal patched)."""
import json

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import build_project_stack


class _WsDbProxy:
    """Proxy test session so ws.py SessionLocal().close() is a no-op."""

    def __init__(self, session):
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def close(self):
        pass


@pytest.fixture
def ws_db(db, monkeypatch):
    def _session_local():
        return _WsDbProxy(db)

    monkeypatch.setattr("app.api.v1.ws.SessionLocal", _session_local)
    monkeypatch.setattr("app.core.ws_protocol.SessionLocal", _session_local)
    return db


def _recv_until(ws, event_type: str, *, limit: int = 12) -> dict:
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if msg.get("type") == event_type:
            return msg
    raise AssertionError(f"did not receive {event_type}")


@pytest.mark.integration
def test_websocket_ping_pong(client, owner, ws_db):
    headers = auth_headers(client, owner.email)
    ticket = client.post("/api/v1/ws/ticket", headers=headers).json()["ticket"]

    with client.websocket_connect(f"/api/v1/ws?ticket={ticket}") as ws:
        presence = json.loads(ws.receive_text())
        assert presence["type"] == "presence.state"
        assert "online_user_ids" in presence["payload"]

        ws.send_text(json.dumps({"type": "ping"}))
        pong = json.loads(ws.receive_text())
        assert pong["type"] == "pong"


@pytest.mark.integration
def test_websocket_subscribe_channel(client, db, org, owner, ws_db):
    from app.models.chat import ChatChannel, ChatMember

    workspace, _ = build_project_stack(db, org, owner)
    channel = ChatChannel(workspace_id=workspace.id, name="ws-test", is_private=True, created_by=owner.id)
    db.add(channel)
    db.flush()
    db.add(ChatMember(channel_id=channel.id, user_id=owner.id))
    db.flush()

    headers = auth_headers(client, owner.email)
    ticket = client.post("/api/v1/ws/ticket", headers=headers).json()["ticket"]

    with client.websocket_connect(f"/api/v1/ws?ticket={ticket}") as ws:
        ws.receive_text()
        ws.send_text(json.dumps({"type": "subscribe.channel", "channel_id": str(channel.id)}))
        ws.send_text(json.dumps({"type": "chat.typing", "channel_id": str(channel.id)}))


@pytest.mark.integration
def test_websocket_whiteboard_subscribe(client, db, org, owner, ws_db):
    from app.models.whiteboard import Whiteboard

    workspace, _ = build_project_stack(db, org, owner)
    board = Whiteboard(workspace_id=workspace.id, name="WS Board", created_by=owner.id)
    db.add(board)
    db.flush()

    headers = auth_headers(client, owner.email)
    ticket = client.post("/api/v1/ws/ticket", headers=headers).json()["ticket"]

    with client.websocket_connect(f"/api/v1/ws?ticket={ticket}") as ws:
        ws.receive_text()
        ws.send_text(json.dumps({"type": "whiteboard.subscribe", "whiteboard_id": str(board.id)}))
        ws.send_text(
            json.dumps(
                {
                    "type": "whiteboard.cursor",
                    "whiteboard_id": str(board.id),
                    "payload": {"x": 1, "y": 2},
                }
            )
        )


@pytest.mark.integration
def test_websocket_doc_subscribe_and_content_relay(client, db, org, owner, ws_db):
    from app.models.document import Document
    from app.models.organization import OrganizationMember
    from app.models.workspace import WorkspaceMember
    from app.tests.conftest import make_user

    workspace, _ = build_project_stack(db, org, owner)
    editor = make_user(db, "doc-collab-editor@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=editor.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=editor.id, role="member"))
    doc = Document(
        workspace_id=workspace.id,
        title="Collab Doc",
        content="<p>hi</p>",
        created_by=owner.id,
        updated_by=owner.id,
        is_private=False,
    )
    db.add(doc)
    db.flush()

    owner_headers = auth_headers(client, owner.email)
    editor_headers = auth_headers(client, editor.email)
    owner_ticket = client.post("/api/v1/ws/ticket", headers=owner_headers).json()["ticket"]
    editor_ticket = client.post("/api/v1/ws/ticket", headers=editor_headers).json()["ticket"]

    with client.websocket_connect(f"/api/v1/ws?ticket={owner_ticket}") as ws_owner:
        ws_owner.receive_text()  # presence.state
        with client.websocket_connect(f"/api/v1/ws?ticket={editor_ticket}") as ws_editor:
            ws_editor.receive_text()
            ws_owner.send_text(
                json.dumps(
                    {
                        "type": "doc.subscribe",
                        "document_id": str(doc.id),
                        "payload": {"username": "Owner"},
                    }
                )
            )
            ws_editor.send_text(
                json.dumps(
                    {
                        "type": "doc.subscribe",
                        "document_id": str(doc.id),
                        "payload": {"username": "Editor"},
                    }
                )
            )
            joined = _recv_until(ws_owner, "doc.presence")
            assert joined["document_id"] == str(doc.id)
            assert joined["payload"]["user_id"] == str(editor.id)

            ws_editor.send_text(
                json.dumps(
                    {
                        "type": "doc.content",
                        "document_id": str(doc.id),
                        "payload": {"content": "<p>live</p>", "version": 3},
                    }
                )
            )
            event = _recv_until(ws_owner, "doc.content")
            assert event["document_id"] == str(doc.id)
            assert event["payload"]["content"] == "<p>live</p>"
            assert event["payload"]["version"] == 3
            assert event["payload"]["user_id"] == str(editor.id)
