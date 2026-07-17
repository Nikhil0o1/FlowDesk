"""Phase 2 unit tests — project team assignment service."""
import pytest
from fastapi import HTTPException

from app.models.organization import OrganizationMember
from app.models.team import Team, TeamMember
from app.services.project_team_service import assign_team_to_project
from app.tests.conftest import make_user
from app.tests.helpers import build_project_stack


@pytest.mark.unit
def test_assign_team_adds_eligible_members(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    team = Team(workspace_id=workspace.id, name="Backend", created_by=owner.id)
    db.add(team)
    db.flush()

    member = make_user(db, "team-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(TeamMember(team_id=team.id, user_id=member.id, role="member"))
    db.flush()

    result = assign_team_to_project(
        db,
        project=project,
        team_id=team.id,
        role="member",
        actor_id=owner.id,
        organization_id=org.id,
    )
    assert result.members_added == 1
    assert result.team_name == "Backend"


@pytest.mark.unit
def test_assign_team_rejects_wrong_workspace(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    other_ws, other_project = build_project_stack(db, org, owner, project_key="OTH")
    team = Team(workspace_id=other_ws.id, name="Other WS Team", created_by=owner.id)
    db.add(team)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        assign_team_to_project(
            db,
            project=project,
            team_id=team.id,
            role="member",
            actor_id=owner.id,
            organization_id=org.id,
        )
    assert exc.value.status_code == 422


@pytest.mark.unit
def test_assign_team_rejects_empty_team(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    team = Team(workspace_id=workspace.id, name="Empty", created_by=owner.id)
    db.add(team)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        assign_team_to_project(
            db,
            project=project,
            team_id=team.id,
            role="member",
            actor_id=owner.id,
            organization_id=org.id,
        )
    assert exc.value.status_code == 422
