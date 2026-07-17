"""Assign workspace teams to projects."""
from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space
from app.models.team import Team, TeamMember
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user


def _build_project(db, org, owner):
    workspace = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=workspace.id, name="Space", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(
        space_id=space.id, workspace_id=workspace.id, name="App", created_by=owner.id
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role="admin"))
    db.flush()
    return workspace, project


def test_assign_team_adds_all_members(client, db, org, owner):
    workspace, project = _build_project(db, org, owner)
    alice = make_user(db, "alice@test.dev")
    bob = make_user(db, "bob@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=alice.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=bob.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=alice.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=bob.id, role="member"))
    team = Team(workspace_id=workspace.id, name="Platform", created_by=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=alice.id, role="member"))
    db.add(TeamMember(team_id=team.id, user_id=bob.id, role="member"))
    db.flush()

    headers = auth_headers(client, "owner@test.dev")
    res = client.post(
        f"/api/v1/projects/{project.id}/teams",
        headers=headers,
        json={"team_id": str(team.id), "role": "member"},
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["team_name"] == "Platform"
    assert data["members_added"] == 2
    assert data["members_skipped"] == 0

    members = client.get(f"/api/v1/projects/{project.id}/members", headers=headers)
    assert members.status_code == 200
    member_ids = {m["user_id"] for m in members.json()}
    assert str(alice.id) in member_ids
    assert str(bob.id) in member_ids

    teams = client.get(f"/api/v1/projects/{project.id}/teams", headers=headers)
    assert teams.status_code == 200
    assert len(teams.json()) == 1
    assert teams.json()[0]["team_name"] == "Platform"


def test_assign_team_twice_rejected(client, db, org, owner):
    workspace, project = _build_project(db, org, owner)
    member = make_user(db, "member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    team = Team(workspace_id=workspace.id, name="Ops", created_by=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=member.id, role="member"))
    db.flush()

    headers = auth_headers(client, "owner@test.dev")
    payload = {"team_id": str(team.id), "role": "viewer"}
    assert client.post(f"/api/v1/projects/{project.id}/teams", headers=headers, json=payload).status_code == 201
    again = client.post(f"/api/v1/projects/{project.id}/teams", headers=headers, json=payload)
    assert again.status_code == 409


def test_assign_team_wrong_workspace_rejected(client, db, org, owner):
    ws1, project = _build_project(db, org, owner)
    ws2 = Workspace(organization_id=org.id, name="Other", created_by=owner.id)
    db.add(ws2)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws2.id, user_id=owner.id, role="admin"))
    team = Team(workspace_id=ws2.id, name="Remote", created_by=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id, role="admin"))
    db.flush()

    headers = auth_headers(client, "owner@test.dev")
    res = client.post(
        f"/api/v1/projects/{project.id}/teams",
        headers=headers,
        json={"team_id": str(team.id), "role": "member"},
    )
    assert res.status_code == 422


def test_project_admin_can_assign_team(client, db, org, owner):
    workspace, project = _build_project(db, org, owner)
    proj_admin = make_user(db, "padmin@test.dev")
    dev = make_user(db, "dev@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=dev.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=proj_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=dev.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    team = Team(workspace_id=workspace.id, name="Squad", created_by=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=dev.id, role="member"))
    db.flush()

    headers = auth_headers(client, "padmin@test.dev")
    res = client.post(
        f"/api/v1/projects/{project.id}/teams",
        headers=headers,
        json={"team_id": str(team.id), "role": "member"},
    )
    assert res.status_code == 201
    assert res.json()["members_added"] == 1


def test_project_member_cannot_assign_team(client, db, org, owner):
    workspace, project = _build_project(db, org, owner)
    member = make_user(db, "plain@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=member.id, role="member"))
    team = Team(workspace_id=workspace.id, name="Dev", created_by=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=member.id, role="member"))
    db.flush()

    headers = auth_headers(client, "plain@test.dev")
    res = client.post(
        f"/api/v1/projects/{project.id}/teams",
        headers=headers,
        json={"team_id": str(team.id), "role": "member"},
    )
    assert res.status_code == 403
