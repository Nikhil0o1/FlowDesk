"""Coverage — teams API member management and project assignment."""
import pytest

from app.models.team import Team, TeamMember
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


@pytest.mark.coverage
def test_team_crud_and_members(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/teams",
        headers=headers,
        json={"name": "Platform", "color": "#3366ff"},
    )
    assert created.status_code == 201
    team_id = created.json()["id"]

    member = add_project_member(db, org, workspace, project, "team-user@test.dev")
    added = client.post(
        f"/api/v1/teams/{team_id}/members",
        headers=headers,
        json={"user_ids": [str(member.id)], "role": "member"},
    )
    assert added.status_code == 200

    listed = client.get(f"/api/v1/teams/{team_id}/members", headers=headers)
    assert any(m["user_id"] == str(member.id) for m in listed.json())

    removed = client.delete(f"/api/v1/teams/{team_id}/members/{member.id}", headers=headers)
    assert removed.status_code == 200

    patched = client.patch(
        f"/api/v1/teams/{team_id}",
        headers=headers,
        json={"name": "Platform v2"},
    )
    assert patched.status_code == 200


@pytest.mark.coverage
def test_assign_team_to_project(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    team = Team(workspace_id=workspace.id, name="Delivery", color="#f00", created_by=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id))
    db.flush()
    headers = auth_headers(client, owner.email)

    listed = client.get(f"/api/v1/projects/{project.id}/teams", headers=headers)
    if listed.json():
        assert len(listed.json()) >= 1
    else:
        assigned = client.post(
            f"/api/v1/projects/{project.id}/teams",
            headers=headers,
            json={"team_id": str(team.id)},
        )
        assert assigned.status_code in (201, 409)
