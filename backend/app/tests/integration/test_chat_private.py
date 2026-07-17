"""Integration — private chat channels and member management."""
import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


@pytest.mark.integration
def test_private_channel_limited_to_invited_members(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "private-chat@test.dev")
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/channels",
        headers=headers,
        json={
            "name": "leadership",
            "is_private": True,
            "member_ids": [str(member.id)],
        },
    )
    assert create.status_code == 201, create.text
    channel_id = create.json()["id"]
    assert create.json()["is_private"] is True

    members = client.get(f"/api/v1/channels/{channel_id}/members", headers=headers)
    member_ids = {m["user_id"] for m in members.json()}
    assert str(owner.id) in member_ids
    assert str(member.id) in member_ids


@pytest.mark.integration
def test_channel_admin_adds_member(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    invitee = add_project_member(db, org, workspace, project, "chat-invitee@test.dev")
    owner_headers = auth_headers(client, owner.email)

    channel_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/channels",
        headers=owner_headers,
        json={"name": "leadership-private", "is_private": True, "member_ids": []},
    ).json()["id"]

    add = client.post(
        f"/api/v1/channels/{channel_id}/members",
        headers=owner_headers,
        json={"user_ids": [str(invitee.id)]},
    )
    assert add.status_code == 200
    assert "1 member" in add.json()["detail"]

    listed = client.get(f"/api/v1/channels/{channel_id}/members", headers=owner_headers)
    assert str(invitee.id) in {m["user_id"] for m in listed.json()}


@pytest.mark.integration
def test_member_can_leave_channel(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "chat-leaver@test.dev")
    owner_headers = auth_headers(client, owner.email)

    channel_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/channels",
        headers=owner_headers,
        json={"name": "general-chat"},
    ).json()["id"]

    client.post(
        f"/api/v1/channels/{channel_id}/members",
        headers=owner_headers,
        json={"user_ids": [str(member.id)]},
    )

    member_headers = auth_headers(client, member.email)
    leave = client.delete(f"/api/v1/channels/{channel_id}/members/{member.id}", headers=member_headers)
    assert leave.status_code == 200
