"""Coverage — chat channel admin, threads, read state, member edits."""
import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


@pytest.mark.coverage
def test_chat_channel_update_and_delete(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    channel_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/channels",
        headers=headers,
        json={"name": "announcements", "description": "Old"},
    ).json()["id"]

    updated = client.patch(
        f"/api/v1/channels/{channel_id}",
        headers=headers,
        json={"description": "Updated description"},
    )
    assert updated.status_code == 200
    assert updated.json()["description"] == "Updated description"

    deleted = client.delete(f"/api/v1/channels/{channel_id}", headers=headers)
    assert deleted.status_code == 200


@pytest.mark.coverage
def test_chat_thread_reply_and_list(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    channel_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/channels",
        headers=headers,
        json={"name": "threads"},
    ).json()["id"]

    parent_id = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=headers,
        json={"body": "Parent message"},
    ).json()["id"]
    reply = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=headers,
        json={"body": "Thread reply", "parent_message_id": parent_id},
    )
    assert reply.status_code == 201
    assert reply.json()["parent_message_id"] == parent_id

    page = client.get(f"/api/v1/channels/{channel_id}/messages", headers=headers, params={"page_size": 10})
    assert page.status_code == 200
    assert page.json()["total"] >= 2


@pytest.mark.coverage
def test_chat_member_add_remove_and_unread(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "chat-ext@test.dev")
    owner_headers = auth_headers(client, owner.email)

    channel_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/channels",
        headers=owner_headers,
        json={"name": "team", "is_private": True, "member_ids": [str(member.id)]},
    ).json()["id"]

    msg_id = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=owner_headers,
        json={"body": "Needs read receipt"},
    ).json()["id"]

    member_headers = auth_headers(client, member.email)
    read = client.post(
        f"/api/v1/channels/{channel_id}/read",
        headers=member_headers,
        json={"message_id": msg_id},
    )
    assert read.status_code == 200

    channels = client.get(f"/api/v1/workspaces/{workspace.id}/channels", headers=member_headers)
    row = next(c for c in channels.json() if c["id"] == channel_id)
    assert row["unread_count"] == 0

    leave = client.delete(f"/api/v1/channels/{channel_id}/members/{member.id}", headers=member_headers)
    assert leave.status_code == 200
