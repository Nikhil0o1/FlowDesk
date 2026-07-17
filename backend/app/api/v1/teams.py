import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, ProjectTeam, Space, SpaceMember
from app.models.team import Team, TeamMember
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import Message
from app.schemas.team import (
    TeamCreate,
    TeamMemberOut,
    TeamMemberRoleUpdate,
    TeamMembersAdd,
    TeamOut,
    TeamUpdate,
)
from app.services.activity_service import log_activity
from app.services.notification_service import notify
from app.services.permission_service import PermissionError403, PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["teams"])


def _team_member_role(db: Session, team_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    return db.scalar(
        select(TeamMember.role).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id,
        )
    )


def _effective_team_role_for_user(db: Session, team: Team, user_id: uuid.UUID) -> str | None:
    workspace = db.get(Workspace, team.workspace_id)
    if not workspace:
        return None
    is_org_owner = db.scalar(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == workspace.organization_id,
            OrganizationMember.user_id == user_id,
            OrganizationMember.role == "owner",
        )
    ) is not None
    if is_org_owner:
        return "owner"
    workspace_role = db.scalar(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == team.workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if workspace_role == "owner":
        return "owner"
    team_role = _team_member_role(db, team.id, user_id)
    if team_role == "admin" or workspace_role == "admin":
        return "admin"
    return team_role


def _effective_team_role(db: Session, perms: PermissionService, team: Team) -> str | None:
    return _effective_team_role_for_user(db, team, perms.user.id)


def _workspace_management_role(db: Session, perms: PermissionService, team: Team) -> str | None:
    workspace = db.get(Workspace, team.workspace_id)
    if not workspace:
        return None
    if perms._is_org_admin_or_owner(workspace.organization_id):
        return "owner"
    workspace_role = perms.workspace_role(team.workspace_id)
    if workspace_role in ("owner", "admin"):
        return workspace_role
    return None


def _team_linked_project_ids(db: Session, team_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(Project.id)
            .join(ProjectTeam, ProjectTeam.project_id == Project.id)
            .where(
                ProjectTeam.team_id == team_id,
                Project.deleted_at.is_(None),
            )
        ).all()
    )


def _is_workspace_scoped_admin(db: Session, perms: PermissionService, workspace_id: uuid.UUID) -> bool:
    """Space or project admin anywhere in this workspace."""
    if db.scalar(
        select(SpaceMember.id)
        .join(Space, Space.id == SpaceMember.space_id)
        .where(
            Space.workspace_id == workspace_id,
            Space.deleted_at.is_(None),
            SpaceMember.user_id == perms.user.id,
            SpaceMember.role == "admin",
        )
        .limit(1)
    ):
        return True
    return (
        db.scalar(
            select(ProjectMember.id)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(
                Project.workspace_id == workspace_id,
                Project.deleted_at.is_(None),
                ProjectMember.user_id == perms.user.id,
                ProjectMember.role == "admin",
            )
            .limit(1)
        )
        is not None
    )


def _can_create_team(db: Session, perms: PermissionService, workspace_id: uuid.UUID) -> bool:
    workspace = db.get(Workspace, workspace_id)
    if not workspace or workspace.deleted_at is not None:
        return False
    if perms._is_org_admin_or_owner(workspace.organization_id):
        return True
    if perms.workspace_role(workspace_id) in ("admin", "owner"):
        return True
    return _is_workspace_scoped_admin(db, perms, workspace_id)


def _require_can_create_team(db: Session, perms: PermissionService, workspace_id: uuid.UUID) -> None:
    if not _can_create_team(db, perms, workspace_id):
        raise PermissionError403("Insufficient permissions to create teams in this workspace")


def _can_manage_team(db: Session, perms: PermissionService, team: Team) -> bool:
    """Edit/delete a team and manage its members. Org owner/admin and workspace admins
    manage any team. A space/project admin manages teams they created or that are
    assigned to a project they administer. Plain members and viewers can only view."""
    if _workspace_management_role(db, perms, team) in ("owner", "admin"):
        return True
    if not _is_workspace_scoped_admin(db, perms, team.workspace_id):
        return False
    if team.created_by == perms.user.id:
        return True
    for project_id in _team_linked_project_ids(db, team.id):
        try:
            perms.require_project_admin(project_id)
            return True
        except PermissionError403:
            continue
    return False


def _can_delete_team(db: Session, perms: PermissionService, team: Team) -> bool:
    return _can_manage_team(db, perms, team)


def _require_can_delete_team(db: Session, perms: PermissionService, team: Team) -> None:
    if not _can_delete_team(db, perms, team):
        raise PermissionError403("Insufficient permissions to delete this team")


def _team_out(db: Session, perms: PermissionService, team: Team) -> TeamOut:
    members = db.scalars(
        select(TeamMember)
        .where(TeamMember.team_id == team.id)
        .order_by(TeamMember.created_at)
    ).all()
    member_ids = [member.user_id for member in members]
    briefs = user_briefs(db, list(member_ids))
    out = TeamOut.model_validate(team)
    out.members = [briefs[uid] for uid in member_ids if uid in briefs]
    out.member_details = []
    for member in members:
        detail = TeamMemberOut.model_validate(member)
        detail.user = briefs.get(member.user_id)
        out.member_details.append(detail)
    out.my_role = _effective_team_role(db, perms, team)
    out.can_manage_members = _can_manage_team(db, perms, team)
    out.can_delete = _can_delete_team(db, perms, team)
    out.can_create_teams = _can_create_team(db, perms, team.workspace_id)
    return out


def _get_team(db: Session, perms: PermissionService, team_id: uuid.UUID) -> Team:
    team = db.get(Team, team_id)
    if not team or team.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Team not found")
    perms.require_workspace_member(team.workspace_id)
    return team


def _require_team_manager(db: Session, perms: PermissionService, team: Team) -> None:
    """Org owner/admin, workspace admin, or a space/project admin in the workspace
    may edit a team and its membership."""
    if not _can_manage_team(db, perms, team):
        raise PermissionError403("Insufficient permissions to manage this team")


def _require_can_manage_team_member(
    db: Session,
    perms: PermissionService,
    team: Team,
    member_user_id: uuid.UUID,
    new_role: str | None = None,
) -> None:
    if not _can_manage_team(db, perms, team):
        raise PermissionError403("Insufficient permissions to manage team members")
    actor_role = _workspace_management_role(db, perms, team)
    if actor_role not in ("owner", "admin"):
        # Space/project admins (and team creators) manage members at "admin" level.
        actor_role = "admin"
    if str(member_user_id) == str(perms.user.id):
        raise PermissionError403("You cannot manage your own team role or membership")
    target_role = _effective_team_role_for_user(db, team, member_user_id)
    if actor_role == "owner":
        if target_role == "owner":
            raise PermissionError403("Team owners cannot be changed here")
        return
    if target_role == "owner":
        raise PermissionError403("Team owners cannot be changed here")
    target_team_role = _team_member_role(db, team.id, member_user_id)
    if target_team_role not in ("admin", "member"):
        raise PermissionError403("Team admins can only manage admins and members")


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
    return [_team_out(db, perms, t) for t in teams]


@router.post("/workspaces/{workspace_id}/teams", response_model=TeamOut, status_code=201)
def create_team(
    workspace_id: uuid.UUID,
    body: TeamCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    _require_can_create_team(db, perms, workspace_id)
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
            role = "admin" if uid == perms.user.id else "member"
            db.add(TeamMember(team_id=team.id, user_id=uid, role=role))
    log_activity(db, workspace_id=workspace_id, action="team.created",
                 actor_id=perms.user.id, data={"team_id": str(team.id), "name": team.name})
    db.commit()
    return _team_out(db, perms, team)


@router.get("/teams/{team_id}", response_model=TeamOut)
def get_team(
    team_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    return _team_out(db, perms, team)


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
    return _team_out(db, perms, team)


@router.delete("/teams/{team_id}", response_model=Message)
def delete_team(
    team_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    _require_can_delete_team(db, perms, team)
    team.deleted_at = datetime.now(timezone.utc)
    log_activity(db, workspace_id=team.workspace_id, action="team.deleted",
                 actor_id=perms.user.id, data={"name": team.name})
    db.commit()
    return Message(detail="Team deleted")


@router.get("/teams/{team_id}/members", response_model=list[TeamMemberOut])
def list_team_members(
    team_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    members = db.scalars(
        select(TeamMember)
        .where(TeamMember.team_id == team.id)
        .order_by(TeamMember.created_at)
    ).all()
    briefs = user_briefs(db, [member.user_id for member in members])
    result = []
    for member in members:
        out = TeamMemberOut.model_validate(member)
        out.user = briefs.get(member.user_id)
        result.append(out)
    return result


@router.post("/teams/{team_id}/members", response_model=TeamOut)
def add_team_members(
    team_id: uuid.UUID,
    body: TeamMembersAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    _require_team_manager(db, perms, team)
    if _effective_team_role(db, perms, team) == "admin" and body.role != "member":
        raise PermissionError403("Team admins can only add members")
    valid_ids = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == team.workspace_id)
        ).all()
    )
    existing = set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == team_id)).all())
    for uid in set(body.user_ids):
        if uid in valid_ids and uid not in existing:
            db.add(TeamMember(team_id=team_id, user_id=uid, role=body.role))
            notify(
                db,
                uid,
                "team_member_added",
                "You were added to a team",
                f"You were added to {team.name} as {body.role}.",
                data={
                    "team_id": str(team.id),
                    "workspace_id": str(team.workspace_id),
                    "role": body.role,
                    "actor_id": str(perms.user.id),
                },
                workspace_id=team.workspace_id,
            )
    log_activity(db, workspace_id=team.workspace_id, action="team.member_added",
                 actor_id=perms.user.id, data={"team_id": str(team.id), "role": body.role})
    db.commit()
    return _team_out(db, perms, team)


@router.patch("/teams/{team_id}/members/{member_user_id}", response_model=Message)
def update_team_member_role(
    team_id: uuid.UUID,
    member_user_id: uuid.UUID,
    body: TeamMemberRoleUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    member = db.scalar(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == member_user_id)
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    _require_can_manage_team_member(db, perms, team, member_user_id, body.role)
    old_role = member.role
    if old_role == body.role:
        return Message(detail="Role unchanged")
    member.role = body.role
    log_activity(db, workspace_id=team.workspace_id, action="team.member_role_changed",
                 actor_id=perms.user.id,
                 data={
                     "team_id": str(team.id),
                     "user_id": str(member_user_id),
                     "old_role": old_role,
                     "role": body.role,
                 })
    notify(
        db,
        member_user_id,
        "team_role_changed",
        "Your team role changed",
        f"Your role in {team.name} changed from {old_role} to {body.role}.",
        data={
            "team_id": str(team.id),
            "workspace_id": str(team.workspace_id),
            "old_role": old_role,
            "role": body.role,
            "actor_id": str(perms.user.id),
        },
        workspace_id=team.workspace_id,
    )
    db.commit()
    return Message(detail="Role updated")


@router.delete("/teams/{team_id}/members/{member_user_id}", response_model=TeamOut)
def remove_team_member(
    team_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    team = _get_team(db, perms, team_id)
    member = db.scalar(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == member_user_id)
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    _require_can_manage_team_member(db, perms, team, member_user_id)
    db.delete(member)
    log_activity(db, workspace_id=team.workspace_id, action="team.member_removed",
                 actor_id=perms.user.id, data={"team_id": str(team.id), "user_id": str(member_user_id)})
    notify(
        db,
        member_user_id,
        "team_member_removed",
        "You were removed from a team",
        f"You were removed from {team.name}.",
        data={
            "team_id": str(team.id),
            "workspace_id": str(team.workspace_id),
            "actor_id": str(perms.user.id),
        },
        workspace_id=team.workspace_id,
    )
    db.commit()
    return _team_out(db, perms, team)
