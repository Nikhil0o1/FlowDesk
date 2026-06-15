from sqlalchemy import select

from app.models.notification import Notification
from app.models.organization import OrganizationMember
from app.models.team import Team, TeamMember
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user


def _add_workspace_user(db, org, workspace, email: str, workspace_role: str = "member"):
    user = make_user(db, email)
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=workspace_role))
    db.flush()
    return user


def _build_team(db, org, owner):
    workspace = Workspace(organization_id=org.id, name="Teams WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))

    workspace_admin = _add_workspace_user(db, org, workspace, "workspace-admin@test.dev", "admin")
    team_admin = _add_workspace_user(db, org, workspace, "team-admin@test.dev")
    member = _add_workspace_user(db, org, workspace, "team-member@test.dev")
    candidate = _add_workspace_user(db, org, workspace, "candidate@test.dev")

    team = Team(
        workspace_id=workspace.id,
        name="Backend Team",
        created_by=owner.id,
    )
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id, role="admin"))
    db.add(TeamMember(team_id=team.id, user_id=team_admin.id, role="admin"))
    db.add(TeamMember(team_id=team.id, user_id=member.id, role="member"))
    db.flush()

    return workspace, team, workspace_admin, team_admin, member, candidate


def test_team_admin_can_add_remove_and_change_member_roles(client, db, org, owner):
    workspace, team, _workspace_admin, _team_admin, _member, candidate = _build_team(db, org, owner)
    headers = auth_headers(client, "team-admin@test.dev")

    listing = client.get(f"/api/v1/workspaces/{workspace.id}/teams", headers=headers)
    assert listing.status_code == 200
    body = listing.json()[0]
    assert body["my_role"] == "admin"
    assert body["can_manage_members"] is True

    added = client.post(
        f"/api/v1/teams/{team.id}/members",
        headers=headers,
        json={"user_ids": [str(candidate.id)], "role": "member"},
    )
    assert added.status_code == 200, added.text
    assert str(candidate.id) in {member["user_id"] for member in added.json()["member_details"]}

    removed = client.delete(f"/api/v1/teams/{team.id}/members/{candidate.id}", headers=headers)
    assert removed.status_code == 200, removed.text
    db.add(TeamMember(team_id=team.id, user_id=candidate.id, role="member"))
    db.flush()

    changed = client.patch(
        f"/api/v1/teams/{team.id}/members/{candidate.id}",
        headers=headers,
        json={"role": "admin"},
    )
    assert changed.status_code == 200, changed.text
    role = db.scalar(
        select(TeamMember.role).where(
            TeamMember.team_id == team.id,
            TeamMember.user_id == candidate.id,
        )
    )
    assert role == "admin"
    assert db.scalar(
        select(Notification).where(
            Notification.user_id == candidate.id,
            Notification.type == "team_role_changed",
        )
    )

    blocked_remove_admin = client.delete(f"/api/v1/teams/{team.id}/members/{candidate.id}", headers=headers)
    assert blocked_remove_admin.status_code == 403


def test_team_owner_and_workspace_admin_can_manage_members(client, db, org, owner):
    workspace, team, workspace_admin, _team_admin, member, _candidate = _build_team(db, org, owner)

    owner_headers = auth_headers(client, "owner@test.dev")
    owner_view = client.get(f"/api/v1/teams/{team.id}", headers=owner_headers)
    assert owner_view.status_code == 200
    assert owner_view.json()["my_role"] == "owner"
    assert owner_view.json()["can_manage_members"] is True

    workspace_admin_headers = auth_headers(client, "workspace-admin@test.dev")
    promoted = client.patch(
        f"/api/v1/teams/{team.id}/members/{member.id}",
        headers=workspace_admin_headers,
        json={"role": "admin"},
    )
    assert promoted.status_code == 200, promoted.text

    removed = client.delete(f"/api/v1/teams/{team.id}/members/{member.id}", headers=owner_headers)
    assert removed.status_code == 200, removed.text


def test_team_member_cannot_manage_other_members_or_leave(client, db, org, owner):
    _workspace, team, _workspace_admin, team_admin, member, candidate = _build_team(db, org, owner)
    headers = auth_headers(client, "team-member@test.dev")

    forbidden_add = client.post(
        f"/api/v1/teams/{team.id}/members",
        headers=headers,
        json={"user_ids": [str(candidate.id)], "role": "member"},
    )
    assert forbidden_add.status_code == 403

    forbidden_role_change = client.patch(
        f"/api/v1/teams/{team.id}/members/{team_admin.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert forbidden_role_change.status_code == 403

    left = client.delete(f"/api/v1/teams/{team.id}/members/{member.id}", headers=headers)
    assert left.status_code == 403


def test_team_admin_cannot_manage_owner_admin_or_self(client, db, org, owner):
    _workspace, team, workspace_admin, team_admin, member, _candidate = _build_team(db, org, owner)
    db.add(TeamMember(team_id=team.id, user_id=workspace_admin.id, role="member"))
    db.flush()
    headers = auth_headers(client, "team-admin@test.dev")

    owner_change = client.patch(
        f"/api/v1/teams/{team.id}/members/{owner.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert owner_change.status_code == 403

    self_remove = client.delete(f"/api/v1/teams/{team.id}/members/{team_admin.id}", headers=headers)
    assert self_remove.status_code == 403

    workspace_admin_remove = client.delete(f"/api/v1/teams/{team.id}/members/{workspace_admin.id}", headers=headers)
    assert workspace_admin_remove.status_code == 403

    promoted = client.patch(
        f"/api/v1/teams/{team.id}/members/{member.id}",
        headers=headers,
        json={"role": "admin"},
    )
    assert promoted.status_code == 200
    demote_admin = client.patch(
        f"/api/v1/teams/{team.id}/members/{member.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert demote_admin.status_code == 200


def test_only_team_owner_can_delete_team(client, db, org, owner):
    _workspace, team, _workspace_admin, _team_admin, _member, _candidate = _build_team(db, org, owner)

    admin_headers = auth_headers(client, "team-admin@test.dev")
    admin_delete = client.delete(f"/api/v1/teams/{team.id}", headers=admin_headers)
    assert admin_delete.status_code == 403

    owner_headers = auth_headers(client, "owner@test.dev")
    owner_delete = client.delete(f"/api/v1/teams/{team.id}", headers=owner_headers)
    assert owner_delete.status_code == 200, owner_delete.text
