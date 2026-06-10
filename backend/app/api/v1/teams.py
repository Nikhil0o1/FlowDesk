import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.models.team import Team, TeamMember
from app.models.workspace import WorkspaceMember
from app.schemas.common import Message
from app.schemas.team import TeamCreate, TeamMembersAdd, TeamOut, TeamUpdate
from app.services.activity_service import log_activity
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["teams"])


def _team_out(db: Session, team: Team) -> TeamOut:
    member_ids = db.scalars(
        select(TeamMember.user_id).where(TeamMember.team_id == team.id)
    ).all()
    briefs = user_briefs(db, list(member_ids))
    out = TeamOut.model_validate(team)
    out.members = [briefs[uid] for uid in member_ids if uid in briefs]
    return out


def _get_team(db: Session, perms: PermissionService, team_id: uuid.UUID) -> Team:
    team = db.get(Team, team_id)
    if not team or team.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Team not found")
    perms.require_workspace_member(team.workspace_id)
    return team


def _require_team_manager(db: Session, perms: PermissionService, team: Team) -> None:
    """Creator or workspace admin/org owner can manage the team."""
    if team.created_by == perms.user.id:
        return
    perms.require_workspace_admin(team.workspace_id)


@router.get("/workspaces/{workspace_id}/teams", response_model=list[TeamOut])
def list_teams(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    teams = db.scalars(
        select(Team)
        .where(Team.workspace_id == workspace_id, Team.deleted_at.is_(None))
        .order_by(Team.created_at)
    ).all()
    return [_team_out(db, t) for t in teams]


@router.post("/workspaces/{workspace_id}/teams", response_model=TeamOut, status_code=201)
def create_team(
    workspace_id: uuid.UUID,
    body: TeamCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    team = Team(
        workspace_id=workspace_id,
        name=body.name,
        description=body.description,
        color=body.color,
        created_by=perms.user.id,
    )
    db.add(team)
    db.flush()
    valid_ids = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)
        ).all()
    )
    # Creator is always a member
    for uid in {perms.user.id, *body.member_ids}:
        if uid == perms.user.id or uid in valid_ids:
            db.add(TeamMember(team_id=team.id, user_id=uid))
    log_activity(db, workspace_id=workspace_id, action="team.created",
                 actor_id=perms.user.id, data={"team_id": str(team.id), "name": team.name})
    db.commit()
    return _team_out(db, team)


@router.get("/teams/{team_id}", response_model=TeamOut)
def get_team(
    team_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    return _team_out(db, team)


@router.patch("/teams/{team_id}", response_model=TeamOut)
def update_team(
    team_id: uuid.UUID,
    body: TeamUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    _require_team_manager(db, perms, team)
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(team, field, value)
    db.commit()
    return _team_out(db, team)


@router.delete("/teams/{team_id}", response_model=Message)
def delete_team(
    team_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    _require_team_manager(db, perms, team)
    team.deleted_at = datetime.now(timezone.utc)
    log_activity(db, workspace_id=team.workspace_id, action="team.deleted",
                 actor_id=perms.user.id, data={"name": team.name})
    db.commit()
    return Message(detail="Team deleted")


@router.post("/teams/{team_id}/members", response_model=TeamOut)
def add_team_members(
    team_id: uuid.UUID,
    body: TeamMembersAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    valid_ids = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == team.workspace_id)
        ).all()
    )
    existing = set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == team_id)).all())
    for uid in set(body.user_ids):
        if uid in valid_ids and uid not in existing:
            db.add(TeamMember(team_id=team_id, user_id=uid))
    db.commit()
    return _team_out(db, team)


@router.delete("/teams/{team_id}/members/{member_user_id}", response_model=TeamOut)
def remove_team_member(
    team_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    if member_user_id != perms.user.id:
        _require_team_manager(db, perms, team)
    member = db.scalar(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == member_user_id)
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()
    return _team_out(db, team)
