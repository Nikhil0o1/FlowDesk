"""Assign workspace teams to projects — bulk-adds team members as project members."""
import uuid

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, ProjectTeam
from app.models.team import Team, TeamMember
from app.models.workspace import WorkspaceMember
from app.services.notification_service import notify


class TeamAssignResult(BaseModel):
    team_id: uuid.UUID
    team_name: str
    members_added: int
    members_skipped: int
    members_ineligible: int


def assign_team_to_project(
    db: Session,
    *,
    project: Project,
    team_id: uuid.UUID,
    role: str,
    actor_id: uuid.UUID,
    organization_id: uuid.UUID,
) -> TeamAssignResult:
    """Link a team to a project and add each eligible team member as a project member."""
    team = db.get(Team, team_id)
    if not team or team.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.workspace_id != project.workspace_id:
        raise HTTPException(status_code=422, detail="Team must belong to the same workspace as the project")

    if db.scalar(
        select(ProjectTeam.id).where(
            ProjectTeam.project_id == project.id,
            ProjectTeam.team_id == team_id,
        )
    ):
        raise HTTPException(status_code=409, detail=f"Team '{team.name}' is already assigned to this project")

    team_user_ids = db.scalars(
        select(TeamMember.user_id).where(TeamMember.team_id == team_id)
    ).all()
    if not team_user_ids:
        raise HTTPException(status_code=422, detail=f"Team '{team.name}' has no members to add")

    existing_project_members = set(
        db.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)
        ).all()
    )

    members_added = 0
    members_skipped = 0
    members_ineligible = 0

    for user_id in team_user_ids:
        if user_id in existing_project_members:
            members_skipped += 1
            continue
        in_org = db.scalar(
            select(OrganizationMember.id).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == user_id,
            )
        )
        if not in_org:
            members_ineligible += 1
            continue
        db.add(ProjectMember(project_id=project.id, user_id=user_id, role=role))
        existing_project_members.add(user_id)
        members_added += 1
        if not db.scalar(
            select(WorkspaceMember.id).where(
                WorkspaceMember.workspace_id == project.workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        ):
            db.add(
                WorkspaceMember(workspace_id=project.workspace_id, user_id=user_id, role="member")
            )
        notify(
            db,
            user_id,
            "project_team_assigned",
            f"You were added to {project.name}",
            f"Your team '{team.name}' was assigned to this project.",
            data={
                "project_id": str(project.id),
                "team_id": str(team.id),
                "workspace_id": str(project.workspace_id),
            },
            workspace_id=project.workspace_id,
            project_id=project.id,
        )

    if members_added == 0 and members_skipped == len(team_user_ids):
        raise HTTPException(
            status_code=409,
            detail=f"All members of '{team.name}' are already on this project",
        )
    if members_added == 0 and members_ineligible > 0:
        raise HTTPException(
            status_code=400,
            detail="No team members could be added — they must belong to the organization",
        )

    db.add(
        ProjectTeam(
            project_id=project.id,
            team_id=team_id,
            default_role=role,
            assigned_by=actor_id,
        )
    )
    db.flush()

    return TeamAssignResult(
        team_id=team.id,
        team_name=team.name,
        members_added=members_added,
        members_skipped=members_skipped,
        members_ineligible=members_ineligible,
    )
