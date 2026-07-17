import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.core.pat_route_registry import pat_allow
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.models.chat import ChatChannel, ChatMember
from app.models.organization import Organization, OrganizationMember
from app.models.project import Project, ProjectMember, Space, SpaceMember
from app.models.task import CustomStatus, Task
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import Message
from app.schemas.organization import InviteOut
from app.schemas.workspace import (
    StatusCount,
    WorkspaceBulkInviteCreate,
    WorkspaceBulkInviteOut,
    WorkspaceCreate,
    WorkspaceInviteCreate,
    WorkspaceMemberAdd,
    ProjectMembershipBrief,
    SpaceMembershipBrief,
    WorkspaceMemberCandidateOut,
    WorkspaceMemberOut,
    WorkspaceMemberRoleUpdate,
    WorkspaceMembershipBrief,
    WorkspaceOut,
    WorkspaceTaskStats,
    WorkspaceUpdate,
)
from app.schemas.dashboard import WorkspaceDashboardOut
from app.schemas.organization import MemberAccessDetail
from app.services import email_service, invite_service
from app.services.audit_service import audit
from app.services.chat_service import emit_public_channel_member_updates, sync_public_channel_members
from app.services.dashboard_service import build_workspace_dashboard
from app.services.member_access_service import build_member_access_detail
from app.services.notification_service import notify
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["workspaces"])


def _with_role(ws: Workspace, role: str | None) -> WorkspaceOut:
    out = WorkspaceOut.model_validate(ws)
    out.my_role = role
    return out


def _display_workspace_role(perms: PermissionService, ws: Workspace) -> str | None:
    """Role label for the current user on a workspace card (membership-first)."""
    org_role = perms.org_role(ws.organization_id)
    if org_role == "owner":
        return "owner"
    ws_role = perms.workspace_role(ws.id)
    if ws_role is not None:
        return ws_role
    if org_role == "admin":
        return "admin"
    return None


@router.get("/organizations/{org_id}/workspaces", response_model=list[WorkspaceOut])
@pat_allow(
    "projects:read",
    rate_category="standard",
    authz_class="tenant",
    tenant_resolution="Path organization_id + org membership",
)
def list_workspaces(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    org_role = perms.require_org_member(org_id)
    if org_role in ("owner", "admin"):
        workspaces = db.scalars(
            select(Workspace)
            .where(Workspace.organization_id == org_id, Workspace.deleted_at.is_(None))
            .order_by(Workspace.created_at)
        ).all()
        return [_with_role(ws, _display_workspace_role(perms, ws)) for ws in workspaces]
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
    org_role = perms.require_org_admin(org_id)
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
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=perms.user.id, role="admin"))
    channel = ChatChannel(workspace_id=ws.id, name="general", is_general=True, created_by=perms.user.id)
    db.add(channel)
    db.flush()
    db.add(ChatMember(channel_id=channel.id, user_id=perms.user.id, role="admin"))
    # Populate the general channel now so it holds every current member of the workspace
    # (the creator plus every org owner/admin), not only once someone opens chat.
    sync_public_channel_members(db, ws.id)
    audit(db, "workspace.created", organization_id=org_id, actor_id=perms.user.id,
          target_type="workspace", target_id=ws.id, data={"name": ws.name})
    db.commit()
    return _with_role(ws, _display_workspace_role(perms, ws))


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceOut)
def get_workspace(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_member(workspace_id)
    return _with_role(ws, _display_workspace_role(perms, ws))


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(
    workspace_id: uuid.UUID,
    body: WorkspaceUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        perms.require_org_admin(ws.organization_id)
    for field, value in changes.items():
        setattr(ws, field, value)
    audit(db, "workspace.updated", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace", target_id=ws.id, data={"fields": list(changes)})
    db.commit()
    return _with_role(ws, _display_workspace_role(perms, ws))


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


@router.get("/workspaces/{workspace_id}/dashboard", response_model=WorkspaceDashboardOut)
def workspace_dashboard(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return build_workspace_dashboard(db, perms, workspace_id)


@router.get("/workspaces/{workspace_id}/task-stats", response_model=WorkspaceTaskStats)
def workspace_task_stats(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Open-task counts by status across the projects this user can see."""
    perms.require_workspace_member(workspace_id)
    accessible = perms.accessible_project_ids()
    if not accessible:
        return WorkspaceTaskStats(total=0, by_status=[])
    base_filter = [
        Task.deleted_at.is_(None),
        Task.is_archived.is_(False),
        Task.parent_task_id.is_(None),
        Task.project_id.in_(
            select(Project.id).where(
                Project.workspace_id == workspace_id, Project.deleted_at.is_(None)
            )
        ),
        Task.project_id.in_(accessible),
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
    ws = perms.require_workspace_member(workspace_id)
    members = db.scalars(
        select(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at)
    ).all()
    member_user_ids = {m.user_id for m in members}
    briefs = user_briefs(db, [m.user_id for m in members])
    # Org owners always surface as "owner", even if their membership row
    # predates that rule and carries a lesser role.
    owner_ids = set(
        db.scalars(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == ws.organization_id,
                OrganizationMember.role == "owner",
            )
        ).all()
    )
    result = []
    for m in members:
        out = WorkspaceMemberOut.model_validate(m)
        out.user = briefs.get(m.user_id)
        if m.user_id in owner_ids:
            out.role = "owner"
        result.append(out)

    # Org owners/admins have implicit workspace access but may lack a
    # WorkspaceMember row — include them so scoped All People is complete.
    org_leader_query = select(OrganizationMember).where(
        OrganizationMember.organization_id == ws.organization_id,
        OrganizationMember.role.in_(("owner", "admin")),
    )
    if member_user_ids:
        org_leader_query = org_leader_query.where(
            OrganizationMember.user_id.notin_(member_user_ids)
        )
    org_leaders = db.scalars(org_leader_query.order_by(OrganizationMember.created_at)).all()
    if org_leaders:
        leader_briefs = user_briefs(db, [om.user_id for om in org_leaders])
        for om in org_leaders:
            result.append(
                WorkspaceMemberOut(
                    id=om.id,
                    user_id=om.user_id,
                    role="owner" if om.role == "owner" else "org_admin",
                    created_at=om.created_at,
                    user=leader_briefs.get(om.user_id),
                )
            )

    return result


@router.get("/workspaces/{workspace_id}/goal-owner-candidates", response_model=list[WorkspaceMemberOut])
def list_goal_owner_candidates(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Org leaders and scoped admins eligible to own goals/targets (not plain members)."""
    perms.require_goals_section_access(workspace_id)
    from app.services.member_candidates import goal_owner_candidate_user_ids

    candidate_ids = goal_owner_candidate_user_ids(db, workspace_id)
    if not candidate_ids:
        return []

    members = list_workspace_members(workspace_id, db, perms)
    by_user = {m.user_id: m for m in members if m.user_id in candidate_ids}
    missing = candidate_ids - set(by_user)
    if missing:
        briefs = user_briefs(db, list(missing))
        ws = perms.get_workspace_or_404(workspace_id)
        for uid in missing:
            om = db.scalar(
                select(OrganizationMember).where(
                    OrganizationMember.organization_id == ws.organization_id,
                    OrganizationMember.user_id == uid,
                )
            )
            by_user[uid] = WorkspaceMemberOut(
                id=om.id if om else uid,
                user_id=uid,
                role="owner" if om and om.role == "owner" else "org_admin" if om else "admin",
                created_at=om.created_at if om else datetime.now(timezone.utc),
                user=briefs.get(uid),
            )

    return sorted(
        by_user.values(),
        key=lambda m: (
            (m.user.full_name or m.user.email or "").lower() if m.user else "",
            str(m.user_id),
        ),
    )


@router.get("/workspaces/{workspace_id}/member-candidates", response_model=list[WorkspaceMemberCandidateOut])
def list_workspace_member_candidates(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Org members assignable to spaces/projects in this workspace (excludes org leaders)."""
    ws = perms.require_workspace_people_manager(workspace_id)
    org_members = db.scalars(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == ws.organization_id)
        .order_by(OrganizationMember.created_at)
    ).all()
    from app.services.member_candidates import assignable_org_members

    candidate_oms = assignable_org_members(org_members)
    candidate_user_ids = [om.user_id for om in candidate_oms]
    briefs = user_briefs(db, candidate_user_ids)

    ws_rows_by_user: dict[uuid.UUID, list[tuple[uuid.UUID, str, str]]] = {}
    space_rows_by_user: dict[uuid.UUID, list[tuple[uuid.UUID, str, str]]] = {}
    project_rows_by_user: dict[uuid.UUID, list[tuple[uuid.UUID, str, str, uuid.UUID]]] = {}
    if candidate_user_ids:
        ws_rows = db.execute(
            select(Workspace.id, Workspace.name, WorkspaceMember.user_id, WorkspaceMember.role)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(
                Workspace.organization_id == ws.organization_id,
                Workspace.deleted_at.is_(None),
                WorkspaceMember.user_id.in_(candidate_user_ids),
            )
            .order_by(Workspace.name)
        ).all()
        for ws_id, ws_name, uid, ws_role in ws_rows:
            ws_rows_by_user.setdefault(uid, []).append((ws_id, ws_name, ws_role))

        # Space/project roles are gathered org-wide (not just this workspace) so a
        # person's full role set renders identically in every workspace's picker.
        space_rows = db.execute(
            select(Space.id, Space.name, SpaceMember.user_id, SpaceMember.role)
            .join(SpaceMember, SpaceMember.space_id == Space.id)
            .join(Workspace, Workspace.id == Space.workspace_id)
            .where(
                Workspace.organization_id == ws.organization_id,
                Workspace.deleted_at.is_(None),
                Space.deleted_at.is_(None),
                SpaceMember.user_id.in_(candidate_user_ids),
            )
            .order_by(Space.name)
        ).all()
        for sp_id, sp_name, uid, sp_role in space_rows:
            space_rows_by_user.setdefault(uid, []).append((sp_id, sp_name, sp_role))

        project_rows = db.execute(
            select(
                Project.id,
                Project.name,
                Project.space_id,
                ProjectMember.user_id,
                ProjectMember.role,
            )
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .join(Workspace, Workspace.id == Project.workspace_id)
            .where(
                Workspace.organization_id == ws.organization_id,
                Workspace.deleted_at.is_(None),
                Project.deleted_at.is_(None),
                Project.is_archived.is_(False),
                Project.is_personal.is_(False),
                ProjectMember.user_id.in_(candidate_user_ids),
            )
            .order_by(Project.name)
        ).all()
        for proj_id, proj_name, sp_id, uid, proj_role in project_rows:
            project_rows_by_user.setdefault(uid, []).append((proj_id, proj_name, sp_id, proj_role))

    out: list[WorkspaceMemberCandidateOut] = []
    for om in candidate_oms:
        memberships = [
            WorkspaceMembershipBrief(workspace_id=r[0], workspace_name=r[1], role=r[2])
            for r in ws_rows_by_user.get(om.user_id, [])
        ]
        space_memberships = [
            SpaceMembershipBrief(space_id=r[0], space_name=r[1], role=r[2])
            for r in space_rows_by_user.get(om.user_id, [])
        ]
        project_memberships = [
            ProjectMembershipBrief(
                project_id=r[0],
                project_name=r[1],
                space_id=r[2],
                role=r[3],
            )
            for r in project_rows_by_user.get(om.user_id, [])
        ]
        out.append(
            WorkspaceMemberCandidateOut(
                user_id=om.user_id,
                user=briefs.get(om.user_id),
                org_role=om.role,
                workspaces=memberships,
                spaces=space_memberships,
                projects=project_memberships,
            )
        )
    return out


@router.get("/workspaces/{workspace_id}/members/{member_user_id}/access", response_model=MemberAccessDetail)
def get_workspace_member_access(
    workspace_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Role breakdown for a member within a workspace (workspace admin or org leader)."""
    ws = perms.require_workspace_admin(workspace_id)
    return build_member_access_detail(
        db,
        perms,
        ws.organization_id,
        member_user_id,
        workspace_id=workspace_id,
    )


@router.post("/workspaces/{workspace_id}/members", response_model=WorkspaceMemberOut, status_code=201)
def add_workspace_member(
    workspace_id: uuid.UUID,
    body: WorkspaceMemberAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    from app.services.role_hierarchy_service import (
        assert_actor_can_manage_member,
        rank_for_workspace_role,
    )

    assert_actor_can_manage_member(
        db, perms, ws.organization_id, body.user_id, grant_rank=rank_for_workspace_role(body.role)
    )
    if not db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == ws.organization_id,
            OrganizationMember.user_id == body.user_id,
        )
    ):
        raise HTTPException(status_code=400, detail="User is not a member of this organization")
    target_is_org_owner = db.scalar(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == ws.organization_id,
            OrganizationMember.user_id == body.user_id,
            OrganizationMember.role == "owner",
        )
    ) is not None
    if target_is_org_owner:
        raise HTTPException(
            status_code=400,
            detail="The organization owner already has access to all workspaces",
        )
    existing = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == body.user_id,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="User is already a member of this workspace")
    member = WorkspaceMember(workspace_id=workspace_id, user_id=body.user_id, role=body.role)
    db.add(member)
    db.flush()
    channel_updates = sync_public_channel_members(db, workspace_id, {body.user_id})
    audit(
        db,
        "member.added",
        organization_id=ws.organization_id,
        actor_id=perms.user.id,
        target_type="workspace_member",
        target_id=body.user_id,
        data={"workspace_id": str(workspace_id), "role": body.role},
    )
    notify(
        db,
        body.user_id,
        "workspace_member_added",
        "Added to workspace",
        f"You were added to {ws.name} as {body.role}.",
        data={"workspace_id": str(workspace_id), "role": body.role, "actor_id": str(perms.user.id)},
        workspace_id=workspace_id,
    )
    db.commit()
    emit_public_channel_member_updates(workspace_id, channel_updates, perms.user.id)
    target_user = db.get(User, body.user_id)
    org = db.get(Organization, ws.organization_id)
    if target_user and org:
        email_service.send_role_access_email(
            target_user.email,
            "workspace",
            body.role,
            org_name=org.name,
            workspace_name=ws.name,
            is_welcome=False,
        )
    briefs = user_briefs(db, [member.user_id])
    out = WorkspaceMemberOut.model_validate(member)
    out.user = briefs.get(member.user_id)
    return out


@router.patch("/workspaces/{workspace_id}/members/{member_user_id}", response_model=Message)
def update_workspace_member_role(
    workspace_id: uuid.UUID,
    member_user_id: uuid.UUID,
    body: WorkspaceMemberRoleUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    from app.services.role_hierarchy_service import (
        assert_actor_can_manage_member,
        rank_for_workspace_role,
    )

    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    assert_actor_can_manage_member(
        db,
        perms,
        ws.organization_id,
        member_user_id,
        grant_rank=rank_for_workspace_role(body.role),
    )
    if member.role in ("admin", "owner") and body.role not in ("admin", "owner"):
        admin_count = db.scalar(
            select(func.count(WorkspaceMember.id)).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.role.in_(("admin", "owner")),
            )
        ) or 0
        if admin_count <= 1 and not perms._is_org_admin_or_owner(ws.organization_id):
            raise HTTPException(status_code=403, detail="Cannot demote the only workspace admin")
    old_role = member.role
    if old_role == body.role:
        return Message(detail="Role unchanged")
    member.role = body.role
    audit(db, "member.role_changed", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace_member", target_id=member_user_id,
          data={"workspace_id": str(workspace_id), "old_role": old_role, "role": body.role})
    notify(
        db,
        member_user_id,
        "workspace_role_changed",
        "Your workspace role changed",
        f"Your role in {ws.name} changed from {old_role} to {body.role}.",
        data={
            "workspace_id": str(workspace_id),
            "old_role": old_role,
            "role": body.role,
            "actor_id": str(perms.user.id),
        },
        workspace_id=workspace_id,
    )
    db.commit()
    target_user = db.get(User, member_user_id)
    org = db.get(Organization, ws.organization_id)
    if target_user and org:
        email_service.send_role_access_email(
            target_user.email,
            "workspace",
            body.role,
            org_name=org.name,
            workspace_name=ws.name,
            is_welcome=False,
        )
    return Message(detail="Role updated")


@router.delete("/workspaces/{workspace_id}/members/{member_user_id}", response_model=Message)
def remove_workspace_member(
    workspace_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    from app.services.role_hierarchy_service import assert_actor_can_manage_member

    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    assert_actor_can_manage_member(db, perms, ws.organization_id, member_user_id)
    if member.role in ("admin", "owner"):
        admin_count = db.scalar(
            select(func.count(WorkspaceMember.id)).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.role.in_(("admin", "owner")),
            )
        ) or 0
        if admin_count <= 1 and not perms._is_org_admin_or_owner(ws.organization_id):
            raise HTTPException(status_code=403, detail="Cannot remove the only workspace admin")
    db.delete(member)
    audit(db, "member.removed", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="workspace_member", target_id=member_user_id,
          data={"workspace_id": str(workspace_id)})
    notify(
        db,
        member_user_id,
        "workspace_member_removed",
        "You were removed from a workspace",
        f"You were removed from {ws.name}.",
        data={"workspace_id": str(workspace_id), "actor_id": str(perms.user.id)},
        workspace_id=workspace_id,
    )
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
    if body.role == "admin" and perms.org_role(ws.organization_id) not in ("owner", "admin"):
        raise HTTPException(
            status_code=403,
            detail="Only an organization admin or owner can invite new workspace admins",
        )
    invite = invite_service.create_invite(
        db, inviter=perms.user, email=body.email, scope="workspace",
        role=body.role, organization_id=ws.organization_id, workspace_id=workspace_id,
    )
    return InviteOut.model_validate(invite)


@router.post("/workspaces/{workspace_id}/invites/bulk", response_model=WorkspaceBulkInviteOut, status_code=201)
@limiter.limit("20/minute")
def create_workspace_bulk_invites(
    request: Request,
    workspace_id: uuid.UUID,
    body: WorkspaceBulkInviteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_can_invite_to_workspace(workspace_id)
    grant_payloads: list[dict] = []
    for grant in body.grants:
        if grant.scope == "space":
            space = perms.require_space_admin(grant.space_id)
            if space.workspace_id != workspace_id:
                raise HTTPException(status_code=400, detail="Space does not belong to this workspace")
            grant_payloads.append(
                {
                    "scope": "space",
                    "role": grant.role,
                    "workspace_id": workspace_id,
                    "space_id": grant.space_id,
                    "project_id": None,
                }
            )
        else:
            project = perms.require_project_admin(grant.project_id)
            if project.workspace_id != workspace_id:
                raise HTTPException(status_code=400, detail="Project does not belong to this workspace")
            grant_payloads.append(
                {
                    "scope": "project",
                    "role": grant.role,
                    "workspace_id": workspace_id,
                    "space_id": None,
                    "project_id": grant.project_id,
                }
            )

    invites, skipped = invite_service.create_invites_bulk(
        db,
        inviter=perms.user,
        email=body.email,
        organization_id=ws.organization_id,
        grants=grant_payloads,
    )
    return WorkspaceBulkInviteOut(
        invites=[InviteOut.model_validate(i) for i in invites],
        skipped=skipped,
    )
