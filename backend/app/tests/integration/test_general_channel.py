"""General channel invariants: created with the workspace, holds all workspace
members, and org owners/admins are common across every workspace's general channel."""
import pytest

from app.models.organization import OrganizationMember
from app.tests.conftest import auth_headers, make_user

pytestmark = pytest.mark.integration


def _create_workspace(client, headers, org_id, name="Marketing"):
    resp = client.post(
        f"/api/v1/organizations/{org_id}/workspaces",
        headers=headers,
        json={"name": name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _general_channel(client, headers, workspace_id):
    channels = client.get(
        f"/api/v1/workspaces/{workspace_id}/channels", headers=headers
    ).json()
    general = [c for c in channels if c.get("is_general")]
    assert len(general) == 1, f"expected exactly one general channel, got {general}"
    assert general[0]["name"] == "general"
    return general[0]


def _member_ids(client, headers, channel_id):
    members = client.get(f"/api/v1/channels/{channel_id}/members", headers=headers).json()
    return {m["user_id"] for m in members}


def test_general_channel_created_with_org_leaders(client, db, org, owner):
    """Creating a workspace makes a general channel that already contains the creator
    plus every org owner/admin — no need for anyone to open chat first."""
    other_admin = make_user(db, "gen-other-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=other_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, owner.email)
    ws_id = _create_workspace(client, headers, org.id)

    general = _general_channel(client, headers, ws_id)
    ids = _member_ids(client, headers, general["id"])
    assert str(owner.id) in ids
    assert str(other_admin.id) in ids  # org admin is common to every general channel


def test_new_workspace_member_auto_joins_general(client, db, org, owner):
    plain = make_user(db, "gen-plain@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=plain.id, role="member"))
    db.flush()

    headers = auth_headers(client, owner.email)
    ws_id = _create_workspace(client, headers, org.id)
    general = _general_channel(client, headers, ws_id)

    # Not a workspace member yet → not in the general channel.
    assert str(plain.id) not in _member_ids(client, headers, general["id"])

    added = client.post(
        f"/api/v1/workspaces/{ws_id}/members",
        headers=headers,
        json={"user_id": str(plain.id), "role": "member"},
    )
    assert added.status_code == 201, added.text
    # Joining the workspace auto-adds them to the general channel.
    assert str(plain.id) in _member_ids(client, headers, general["id"])


def test_org_admin_promotion_joins_all_general_channels(client, db, org, owner):
    promotable = make_user(db, "gen-promote@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=promotable.id, role="member"))
    db.flush()

    headers = auth_headers(client, owner.email)
    ws_a = _create_workspace(client, headers, org.id, name="Alpha")
    ws_b = _create_workspace(client, headers, org.id, name="Beta")
    gen_a = _general_channel(client, headers, ws_a)
    gen_b = _general_channel(client, headers, ws_b)

    assert str(promotable.id) not in _member_ids(client, headers, gen_a["id"])

    promote = client.patch(
        f"/api/v1/organizations/{org.id}/members/{promotable.id}",
        headers=headers,
        json={"role": "admin"},
    )
    assert promote.status_code == 200, promote.text

    # Now common to the general channel of every workspace in the org.
    assert str(promotable.id) in _member_ids(client, headers, gen_a["id"])
    assert str(promotable.id) in _member_ids(client, headers, gen_b["id"])


def test_org_admin_demotion_keeps_only_affiliated_general_channels(client, db, org, owner):
    """Demoted org admin stays in the general channel of workspaces they actually belong
    to, and is dropped from the general channels of workspaces where they were present
    only because they were an org leader."""
    user = make_user(db, "gen-demote@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    db.flush()

    headers = auth_headers(client, owner.email)
    ws_a = _create_workspace(client, headers, org.id, name="Home")
    ws_b = _create_workspace(client, headers, org.id, name="Elsewhere")

    # Genuine member of workspace A only.
    client.post(
        f"/api/v1/workspaces/{ws_a}/members",
        headers=headers,
        json={"user_id": str(user.id), "role": "member"},
    )
    # Promote to org admin → now in both general channels.
    client.patch(
        f"/api/v1/organizations/{org.id}/members/{user.id}",
        headers=headers,
        json={"role": "admin"},
    )
    gen_a = _general_channel(client, headers, ws_a)
    gen_b = _general_channel(client, headers, ws_b)
    assert str(user.id) in _member_ids(client, headers, gen_a["id"])
    assert str(user.id) in _member_ids(client, headers, gen_b["id"])

    # Demote back to plain org member.
    demote = client.patch(
        f"/api/v1/organizations/{org.id}/members/{user.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert demote.status_code == 200, demote.text

    # Stays in A (real workspace member); dropped from B (was there only as org leader).
    assert str(user.id) in _member_ids(client, headers, gen_a["id"])
    assert str(user.id) not in _member_ids(client, headers, gen_b["id"])


def test_general_channel_cannot_be_modified_by_non_workspace_admin(client, db, org, owner):
    """Space/project-level members can't delete or rename the general channel."""
    from app.tests.helpers import add_project_member, build_project_stack

    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "gen-proj-member@test.dev")
    owner_headers = auth_headers(client, owner.email)

    general = _general_channel(client, owner_headers, workspace.id)
    member_headers = auth_headers(client, member.email)

    # A plain project member can see the channel but cannot rename or delete it.
    rename = client.patch(
        f"/api/v1/channels/{general['id']}",
        headers=member_headers,
        json={"name": "renamed"},
    )
    assert rename.status_code == 403
    delete = client.delete(f"/api/v1/channels/{general['id']}", headers=member_headers)
    assert delete.status_code == 403
