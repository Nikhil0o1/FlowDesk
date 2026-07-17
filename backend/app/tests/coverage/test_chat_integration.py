"""Phase 6 — chat channel and messaging API."""
import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import build_project_stack


@pytest.mark.coverage
def test_chat_channel_create_and_message_flow(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/channels",
        headers=headers,
        json={"name": "general", "description": "Team chat"},
    )
    assert create.status_code == 201, create.text
    channel_id = create.json()["id"]

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/channels", headers=headers)
    assert listed.status_code == 200
    assert any(c["id"] == channel_id for c in listed.json())

    message = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=headers,
        json={"body": "Hello team"},
    )
    assert message.status_code == 201
    assert message.json()["body"] == "Hello team"

    page = client.get(f"/api/v1/channels/{channel_id}/messages", headers=headers)
    assert page.status_code == 200
    assert page.json()["total"] >= 1


@pytest.mark.coverage
def test_chat_mark_read(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    channel_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/channels",
        headers=headers,
        json={"name": "updates"},
    ).json()["id"]
    msg_id = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=headers,
        json={"body": "Ping"},
    ).json()["id"]

    read = client.post(
        f"/api/v1/channels/{channel_id}/read",
        headers=headers,
        json={"message_id": msg_id},
    )
    assert read.status_code == 200
