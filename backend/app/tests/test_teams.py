from sqlalchemy import select

from app.models.notification import Notification
from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, ProjectTeam, Space, SpaceMember
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


def test_workspace_admin_can_add_remove_and_change_member_roles(client, db, org, owner):
    workspace, team, _workspace_admin, _team_admin, _member, candidate = _build_team(db, org, owner)
    headers = auth_headers(client, "workspace-admin@test.dev")

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

    removed_admin = client.delete(f"/api/v1/teams/{team.id}/members/{candidate.id}", headers=headers)
    assert removed_admin.status_code == 200, removed_admin.text


def test_stale_team_admin_workspace_member_cannot_manage_members(client, db, org, owner):
    workspace, team, _workspace_admin, team_admin, member, candidate = _build_team(db, org, owner)
    headers = auth_headers(client, "team-admin@test.dev")

    listing = client.get(f"/api/v1/workspaces/{workspace.id}/teams", headers=headers)
    assert listing.status_code == 200
    body = listing.json()[0]
    assert body["my_role"] == "admin"
    assert body["can_manage_members"] is False

    forbidden_add = client.post(
        f"/api/v1/teams/{team.id}/members",
        headers=headers,
        json={"user_ids": [str(candidate.id)], "role": "member"},
    )
    assert forbidden_add.status_code == 403

    forbidden_remove = client.delete(f"/api/v1/teams/{team.id}/members/{member.id}", headers=headers)
    assert forbidden_remove.status_code == 403

    forbidden_role_change = client.patch(
        f"/api/v1/teams/{team.id}/members/{team_admin.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert forbidden_role_change.status_code == 403


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


def test_workspace_admin_team_creator_is_not_owner(client, db, org, owner):
    workspace, team, _workspace_admin, team_admin, _member, _candidate = _build_team(db, org, owner)
    team.created_by = team_admin.id
    db.flush()
    headers = auth_headers(client, "team-admin@test.dev")

    response = client.get(f"/api/v1/teams/{team.id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["my_role"] == "admin"
    assert response.json()["can_manage_members"] is False


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


def test_stale_team_admin_cannot_manage_owner_admin_or_self(client, db, org, owner):
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
    assert promoted.status_code == 403
    demote_admin = client.patch(
        f"/api/v1/teams/{team.id}/members/{member.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert demote_admin.status_code == 403


def test_authorized_roles_can_delete_team(client, db, org, owner):
    workspace, team, workspace_admin, team_admin, _member, _candidate = _build_team(db, org, owner)

    org_admin = make_user(db, "org-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    db.flush()

    org_admin_listing = client.get(
        f"/api/v1/workspaces/{workspace.id}/teams",
        headers=auth_headers(client, "org-admin@test.dev"),
    )
    assert org_admin_listing.status_code == 200, org_admin_listing.text
    assert org_admin_listing.json()[0]["can_delete"] is True
    assert org_admin_listing.json()[0]["can_create_teams"] is True

    admin_headers = auth_headers(client, "team-admin@test.dev")
    admin_delete = client.delete(f"/api/v1/teams/{team.id}", headers=admin_headers)
    assert admin_delete.status_code == 403

    workspace_admin_delete = client.delete(
        f"/api/v1/teams/{team.id}",
        headers=auth_headers(client, "workspace-admin@test.dev"),
    )
    assert workspace_admin_delete.status_code == 200, workspace_admin_delete.text

    team2 = Team(workspace_id=workspace.id, name="Another Team", created_by=owner.id)
    db.add(team2)
    db.flush()

    org_admin_delete = client.delete(
        f"/api/v1/teams/{team2.id}",
        headers=auth_headers(client, "org-admin@test.dev"),
    )
    assert org_admin_delete.status_code == 200, org_admin_delete.text

    team3 = Team(workspace_id=workspace.id, name="Owner Team", created_by=owner.id)
    db.add(team3)
    db.flush()

    owner_delete = client.delete(
        f"/api/v1/teams/{team3.id}",
        headers=auth_headers(client, "owner@test.dev"),
    )
    assert owner_delete.status_code == 200, owner_delete.text


def test_project_and_space_admin_can_delete_linked_team(client, db, org, owner):
    workspace, team, _workspace_admin, _team_admin, _member, _candidate = _build_team(db, org, owner)
    space = Space(workspace_id=workspace.id, name="Product", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(
        space_id=space.id,
        workspace_id=workspace.id,
        name="App",
        created_by=owner.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectTeam(project_id=project.id, team_id=team.id, assigned_by=owner.id))

    space_admin = _add_workspace_user(db, org, workspace, "space-admin@test.dev")
    db.add(SpaceMember(space_id=space.id, user_id=space_admin.id, role="admin"))
    project_admin = _add_workspace_user(db, org, workspace, "project-admin@test.dev")
    db.add(ProjectMember(project_id=project.id, user_id=project_admin.id, role="admin"))
    db.flush()

    unlinked_team = Team(workspace_id=workspace.id, name="Unlinked", created_by=owner.id)
    db.add(unlinked_team)
    db.flush()

    space_admin_unlinked = client.delete(
        f"/api/v1/teams/{unlinked_team.id}",
        headers=auth_headers(client, "space-admin@test.dev"),
    )
    assert space_admin_unlinked.status_code == 403

    space_admin_linked = client.delete(
        f"/api/v1/teams/{team.id}",
        headers=auth_headers(client, "space-admin@test.dev"),
    )
    assert space_admin_linked.status_code == 200, space_admin_linked.text

    team2 = Team(workspace_id=workspace.id, name="Linked Again", created_by=owner.id)
    db.add(team2)
    db.flush()
    db.add(ProjectTeam(project_id=project.id, team_id=team2.id, assigned_by=owner.id))
    db.flush()

    listing = client.get(
        f"/api/v1/workspaces/{workspace.id}/teams",
        headers=auth_headers(client, "project-admin@test.dev"),
    )
    assert listing.status_code == 200
    by_id = {row["id"]: row for row in listing.json()}
    assert by_id[str(team2.id)]["can_delete"] is True

    project_admin_delete = client.delete(
        f"/api/v1/teams/{team2.id}",
        headers=auth_headers(client, "project-admin@test.dev"),
    )
    assert project_admin_delete.status_code == 200, project_admin_delete.text


def test_scoped_admins_can_create_teams(client, db, org, owner):
    workspace, team, workspace_admin, _team_admin, member, _candidate = _build_team(db, org, owner)
    space = Space(workspace_id=workspace.id, name="Product", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(
        space_id=space.id,
        workspace_id=workspace.id,
        name="App",
        created_by=owner.id,
    )
    db.add(project)
    db.flush()

    space_admin = _add_workspace_user(db, org, workspace, "space-create@test.dev")
    db.add(SpaceMember(space_id=space.id, user_id=space_admin.id, role="admin"))
    project_admin = _add_workspace_user(db, org, workspace, "project-create@test.dev")
    db.add(ProjectMember(project_id=project.id, user_id=project_admin.id, role="admin"))
    db.flush()

    member_create = client.post(
        f"/api/v1/workspaces/{workspace.id}/teams",
        headers=auth_headers(client, "team-member@test.dev"),
        json={"name": "Blocked Team"},
    )
    assert member_create.status_code == 403

    workspace_admin_create = client.post(
        f"/api/v1/workspaces/{workspace.id}/teams",
        headers=auth_headers(client, "workspace-admin@test.dev"),
        json={"name": "Workspace Admin Team"},
    )
    assert workspace_admin_create.status_code == 201, workspace_admin_create.text
    assert workspace_admin_create.json()["can_create_teams"] is True

    space_admin_create = client.post(
        f"/api/v1/workspaces/{workspace.id}/teams",
        headers=auth_headers(client, "space-create@test.dev"),
        json={"name": "Space Admin Team"},
    )
    assert space_admin_create.status_code == 201, space_admin_create.text

    project_admin_create = client.post(
        f"/api/v1/workspaces/{workspace.id}/teams",
        headers=auth_headers(client, "project-create@test.dev"),
        json={"name": "Project Admin Team"},
    )
    assert project_admin_create.status_code == 201, project_admin_create.text
