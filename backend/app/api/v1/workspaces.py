import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.models.chat import ChatChannel, ChatMember
from app.models.project import Project
from app.models.task import CustomStatus, Task
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import Message
from app.schemas.organization import InviteOut
from app.schemas.workspace import (
    StatusCount,
    WorkspaceCreate,
    WorkspaceInviteCreate,
    WorkspaceMemberOut,
    WorkspaceMemberRoleUpdate,
    WorkspaceOut,
    WorkspaceTaskStats,
    WorkspaceUpdate,
)
from app.services import invite_service
from app.services.audit_service import audit
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["workspaces"])


def _with_role(ws: Workspace, role: str | None) -> WorkspaceOut:
    out = WorkspaceOut.model_validate(ws)
    out.my_role = role
    return out


@router.get("/organizations/{org_id}/workspaces", response_model=list[WorkspaceOut])
def list_workspaces(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    org_role = perms.require_org_member(org_id)
    if org_role == "owner":
        workspaces = db.scalars(
            select(Workspace)
            .where(Workspace.organization_id == org_id, Workspace.deleted_at.is_(None))
            .order_by(Workspace.created_at)
        ).all()
        roles = {
            m.workspace_id: m.role
            for m in db.scalars(
                select(WorkspaceMember).where(WorkspaceMember.user_id == perms.user.id)
            ).all()
        }
        return [_with_role(ws, roles.get(ws.id, "owner")) for ws in workspaces]
    rows = db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.organization_id == org_id,
            Workspace.deleted_at.is_(None),
            WorkspaceMember.user_id == perms.user.id,
        )
        .order_by(Workspace.created_at)
    ).all()
    return [_with_role(ws, role) for ws, role in rows]


@router.post("/organizations/{org_id}/workspaces", response_model=WorkspaceOut, status_code=201)
def create_workspace(
    org_id: uuid.UUID,
    body: WorkspaceCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    ws = Workspace(
        organization_id=org_id,
        name=body.name,
        description=body.description,
        color=body.color,
        icon=body.icon,
        created_by=perms.user.id,
    )
    db.add(ws)
    db.flush()
    # Creator joins as workspace admin
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=perms.user.id, role="admin"))
    # Default chat channel
    channel = ChatChannel(workspace_id=ws.id, name="general", created_by=perms.user.id)
    db.add(channel)
    db.flush()
    db.add(ChatMember(channel_id=channel.id, user_id=perms.user.id, role="admin"))
    audit(db, "workspace.created", organization_id=org_id, actor_id=perms.user.id,
          target_type="workspace", target_id=ws.id, data={"name": ws.name})
    db.commit()
    return _with_role(ws, "admin")


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceOut)
def get_workspace(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_member(workspace_id)
    role = perms.workspace_role(workspace_id)
    if role is None and perms.org_role(ws.organization_id) == "owner":
        role = "owner"
    return _with_role(ws, role)


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(
    workspace_id: uuid.UUID,
    body: WorkspaceUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(ws, field, value)
    audit(db, "workspace.updated", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace", target_id=ws.id, data={"fields": list(changes)})
    db.commit()
    return _with_role(ws, perms.workspace_role(workspace_id) or "owner")


@router.post("/workspaces/{workspace_id}/archive", response_model=Message)
def archive_workspace(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_owner(workspace_id)
    ws.is_archived = True
    ws.archived_at = datetime.now(timezone.utc)
    audit(db, "workspace.archived", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace", target_id=ws.id)
    db.commit()
    return Message(detail="Workspace archived")


@router.post("/workspaces/{workspace_id}/unarchive", response_model=Message)
def unarchive_workspace(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_owner(workspace_id)
    ws.is_archived = False
    ws.archived_at = None
    audit(db, "workspace.unarchived", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace", target_id=ws.id)
    db.commit()
    return Message(detail="Workspace restored")


@router.delete("/workspaces/{workspace_id}", response_model=Message)
def delete_workspace(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_owner(workspace_id)
    ws.deleted_at = datetime.now(timezone.utc)
    audit(db, "workspace.deleted", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace", target_id=ws.id, data={"name": ws.name})
    db.commit()
    return Message(detail="Workspace deleted")


@router.get("/workspaces/{workspace_id}/task-stats", response_model=WorkspaceTaskStats)
def workspace_task_stats(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Open-task counts by status across the projects this user can see."""
    perms.require_workspace_member(workspace_id)
    accessible = perms.accessible_project_ids()
    base_filter = [
        Task.deleted_at.is_(None),
        Task.is_archived.is_(False),
        Task.parent_task_id.is_(None),
        Task.project_id.in_(
            select(Project.id).where(
                Project.workspace_id == workspace_id, Project.deleted_at.is_(None)
            )
        ),
        Task.project_id.in_(accessible) if accessible else Task.project_id.is_(None),
    ]
    rows = db.execute(
        select(CustomStatus.name, CustomStatus.color, func.count(Task.id))
        .join(Task, Task.status_id == CustomStatus.id)
        .where(*base_filter)
        .group_by(CustomStatus.name, CustomStatus.color)
        .order_by(func.count(Task.id).desc())
    ).all()
    by_status = [StatusCount(name=r[0], color=r[1], count=r[2]) for r in rows]
    return WorkspaceTaskStats(total=sum(s.count for s in by_status), by_status=by_status)


@router.get("/workspaces/{workspace_id}/members", response_model=list[WorkspaceMemberOut])
def list_workspace_members(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    members = db.scalars(
        select(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    result = []
    for m in members:
        out = WorkspaceMemberOut.model_validate(m)
        out.user = briefs.get(m.user_id)
        result.append(out)
    return result


@router.patch("/workspaces/{workspace_id}/members/{member_user_id}", response_model=Message)
def update_workspace_member_role(
    workspace_id: uuid.UUID,
    member_user_id: uuid.UUID,
    body: WorkspaceMemberRoleUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.role = body.role
    audit(db, "member.role_changed", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace_member", target_id=member_user_id,
          data={"workspace_id": str(workspace_id), "role": body.role})
    db.commit()
    return Message(detail="Role updated")


@router.delete("/workspaces/{workspace_id}/members/{member_user_id}", response_model=Message)
def remove_workspace_member(
    workspace_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    audit(db, "member.removed", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace_member", target_id=member_user_id,
          data={"workspace_id": str(workspace_id)})
    db.commit()
    return Message(detail="Member removed")


@router.post("/workspaces/{workspace_id}/invites", response_model=InviteOut, status_code=201)
@limiter.limit("20/minute")
def create_workspace_invite(
    request: Request,
    workspace_id: uuid.UUID,
    body: WorkspaceInviteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_can_invite_to_workspace(workspace_id)
    invite = invite_service.create_invite(
        db, inviter=perms.user, email=body.email, scope="workspace",
        role=body.role, organization_id=ws.organization_id, workspace_id=workspace_id,
    )
    return InviteOut.model_validate(invite)
