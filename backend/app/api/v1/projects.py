import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.pat_route_registry import pat_allow
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.schemas.dashboard import ProjectDashboardOut, ProjectMemberDashboardOut, SpaceDashboardOut
from app.services.dashboard_service import (
    build_project_dashboard,
    build_project_member_dashboard,
    build_space_dashboard,
)
from app.models.activity import ActivityLog
from app.models.organization import Organization, OrganizationMember
from app.models.project import Project, ProjectMember, ProjectTeam, Space, SpaceMember, TaskList
from app.models.task import CustomStatus, Task
from app.models.team import Team, TeamMember
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.common import Message, Page
from app.schemas.organization import InviteOut, MemberAccessDetail
from app.schemas.project import (
    ActivityOut,
    CustomStatusCreate,
    CustomStatusOut,
    CustomStatusUpdate,
    ProjectCreate,
    ProjectInviteCreate,
    ProjectMemberAdd,
    ProjectMemberCandidateOut,
    ProjectMemberOut,
    ProjectMemberRoleUpdate,
    ProjectOut,
    ScopedBulkInviteCreate,
    ScopedBulkInviteOut,
    ProjectTeamAssign,
    ProjectTeamAssignResult,
    ProjectTeamOut,
    ProjectUpdate,
    SpaceCreate,
    SpaceInviteRequest,
    SpaceMemberOut,
    SpaceOut,
    SpaceUpdate,
    TaskListCreate,
    TaskListOut,
    TaskListUpdate,
)
from app.schemas.workspace import (
    ProjectMembershipBrief,
    SpaceMembershipBrief,
    WorkspaceMemberCandidateOut,
    WorkspaceMembershipBrief,
)
from app.services import email_service, invite_service, webhook_service
from app.services.activity_service import log_activity
from app.services.audit_service import audit
from app.services.chat_service import emit_public_channel_member_updates, sync_public_channel_members
from app.services.permission_service import PermissionService
from app.services.project_team_service import assign_team_to_project
from app.services.user_service import user_briefs
from app.services.notification_service import notify

router = APIRouter(tags=["projects"])

DEFAULT_STATUSES = [
    ("To Do", "#87909E", "todo", 0),
    ("In Progress", "#5B9FF0", "in_progress", 1),
    ("In Review", "#B07BE0", "in_progress", 2),
    ("Complete", "#4CB782", "done", 3),
]


# ---------------- Spaces ----------------

def _space_with_role(space: Space, perms: PermissionService) -> SpaceOut:
    from app.models.workspace import Workspace as WS
    workspace = perms.db.get(WS, space.workspace_id)
    org_role = perms.org_role(workspace.organization_id) if workspace else None
    if org_role in ("owner", "admin"):
        my_role = org_role
    else:
        ws_role = perms.workspace_role(space.workspace_id)
        if ws_role in ("admin", "owner"):
            my_role = "admin"
        else:
            my_role = perms.space_role(space.id)
    out = SpaceOut.model_validate(space)
    out.my_role = my_role
    return out


@router.get("/workspaces/{workspace_id}/spaces", response_model=list[SpaceOut])
def list_spaces(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_member(workspace_id)
    is_ws_admin = (
        perms.workspace_role(workspace_id) in ("admin", "owner")
        or perms.org_role(ws.organization_id) in ("owner", "admin")
    )
    query = select(Space).where(Space.workspace_id == workspace_id, Space.deleted_at.is_(None))
    if not is_ws_admin:
        # A project member only sees the space(s) that hold their project(s) — not siblings.
        accessible = perms.accessible_space_ids()
        if not accessible:
            return []
        query = query.where(Space.id.in_(accessible))
    spaces = db.scalars(query.order_by(Space.position, Space.created_at)).all()
    return [_space_with_role(s, perms) for s in spaces]


@router.post("/workspaces/{workspace_id}/spaces", response_model=SpaceOut, status_code=201)
def create_space(
    workspace_id: uuid.UUID,
    body: SpaceCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    space = Space(
        workspace_id=workspace_id, name=body.name, color=body.color, icon=body.icon,
        created_by=perms.user.id,
    )
    db.add(space)
    db.flush()
    # Add creator as space admin (unless they're already an org/workspace admin who bypasses)
    if not perms._is_org_admin_or_owner(ws.organization_id):
        if perms.workspace_role(workspace_id) not in ("admin", "owner"):
            db.add(SpaceMember(space_id=space.id, user_id=perms.user.id, role="admin"))
    log_activity(db, workspace_id=workspace_id, action="space.created",
                 actor_id=perms.user.id, data={"space_id": str(space.id), "name": space.name})
    audit(db, "space.created", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="space", target_id=space.id, data={"name": space.name})
    db.commit()
    return _space_with_role(space, perms)


@router.patch("/spaces/{space_id}", response_model=SpaceOut)
def update_space(
    space_id: uuid.UUID,
    body: SpaceUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    space = perms.require_space_admin(space_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        from app.models.workspace import Workspace as WS
        workspace = db.get(WS, space.workspace_id)
        perms.require_org_admin(workspace.organization_id)
    for field, value in changes.items():
        setattr(space, field, value)
    db.commit()
    return _space_with_role(space, perms)


@router.delete("/spaces/{space_id}", response_model=Message)
def delete_space(
    space_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.models.workspace import Workspace as WS
    space = perms.require_space_admin(space_id)
    workspace = db.get(WS, space.workspace_id)
    space.deleted_at = datetime.now(timezone.utc)
    audit(db, "space.deleted", organization_id=workspace.organization_id, actor_id=perms.user.id,
          target_type="space", target_id=space.id, data={"name": space.name})
    db.commit()
    return Message(detail="Space deleted")


# ---------------- Space Members ----------------

@router.get("/spaces/{space_id}/members", response_model=list[SpaceMemberOut])
def list_space_members(
    space_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_space_member(space_id)
    members = db.scalars(
        select(SpaceMember).where(SpaceMember.space_id == space_id)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    result = []
    for m in members:
        out = SpaceMemberOut.model_validate(m)
        out.user = briefs.get(m.user_id)
        result.append(out)
    return result


@router.get("/spaces/{space_id}/members/{member_user_id}/access", response_model=MemberAccessDetail)
def get_space_member_access(
    space_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Role breakdown for a member within a space (space admin or higher)."""
    space = perms.require_space_admin(space_id)
    ws = perms.get_workspace_or_404(space.workspace_id)
    return build_member_access_detail(
        db,
        perms,
        ws.organization_id,
        member_user_id,
        space_id=space_id,
    )


@router.post("/spaces/{space_id}/members", response_model=SpaceMemberOut, status_code=201)
def add_space_member(
    space_id: uuid.UUID,
    body: ProjectMemberAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Directly add an existing org member to the space (no invite required)."""
    space = perms.require_space_admin(space_id)
    ws = perms.get_workspace_or_404(space.workspace_id)
    from app.services.role_hierarchy_service import (
        assert_actor_can_manage_member,
        rank_for_space_role,
    )

    assert_actor_can_manage_member(
        db, perms, ws.organization_id, body.user_id, grant_rank=rank_for_space_role(body.role)
    )
    if not db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == ws.organization_id,
            OrganizationMember.user_id == body.user_id,
        )
    ):
        raise HTTPException(status_code=400, detail="User is not a member of this organization")
    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=422, detail="Space role must be 'admin' or 'member'")
    existing = db.scalar(
        select(SpaceMember).where(
            SpaceMember.space_id == space_id,
            SpaceMember.user_id == body.user_id,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="User is already a member of this space")
    member = SpaceMember(space_id=space_id, user_id=body.user_id, role=body.role)
    db.add(member)
    workspace_member_added = False
    if not db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == space.workspace_id,
            WorkspaceMember.user_id == body.user_id,
        )
    ):
        db.add(
            WorkspaceMember(
                workspace_id=space.workspace_id,
                user_id=body.user_id,
                role="member",
            )
        )
        workspace_member_added = True
    db.flush()
    channel_updates = (
        sync_public_channel_members(db, space.workspace_id, {body.user_id})
        if workspace_member_added
        else []
    )
    db.commit()
    emit_public_channel_member_updates(space.workspace_id, channel_updates, perms.user.id)
    target_user = db.get(User, body.user_id)
    org = db.get(Organization, ws.organization_id)
    if target_user and org:
        email_service.send_role_access_email(
            target_user.email,
            "space",
            member.role,
            org_name=org.name,
            workspace_name=ws.name,
            space_name=space.name,
            is_welcome=False,
        )
    briefs = user_briefs(db, [member.user_id])
    out = SpaceMemberOut.model_validate(member)
    out.user = briefs.get(member.user_id)
    return out


@router.patch("/spaces/{space_id}/members/{user_id}", response_model=SpaceMemberOut)
def update_space_member_role(
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    body: dict,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_space_admin(space_id)
    role = body.get("role")
    if role not in ("admin", "member"):
        raise HTTPException(status_code=422, detail="role must be 'admin' or 'member'")
    member = db.scalar(select(SpaceMember).where(SpaceMember.space_id == space_id, SpaceMember.user_id == user_id))
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    space = perms.get_space_or_404(space_id)
    ws = perms.get_workspace_or_404(space.workspace_id)
    from app.services.role_hierarchy_service import (
        assert_actor_can_manage_member,
        rank_for_space_role,
    )

    assert_actor_can_manage_member(
        db, perms, ws.organization_id, user_id, grant_rank=rank_for_space_role(role)
    )
    if member.role == "admin" and role != "admin":
        admin_count = db.scalar(
            select(func.count(SpaceMember.id)).where(
                SpaceMember.space_id == space_id,
                SpaceMember.role == "admin",
            )
        ) or 0
        can_bypass = perms._is_org_admin_or_owner(ws.organization_id) or perms.workspace_role(
            space.workspace_id
        ) in ("admin", "owner")
        if admin_count <= 1 and not can_bypass:
            raise HTTPException(status_code=403, detail="Cannot demote the only space admin")
    old_role = member.role
    if old_role == role:
        briefs = user_briefs(db, [member.user_id])
        out = SpaceMemberOut.model_validate(member)
        out.user = briefs.get(member.user_id)
        return out
    member.role = role
    db.commit()
    target_user = db.get(User, user_id)
    org = db.get(Organization, ws.organization_id)
    if target_user and org:
        email_service.send_role_access_email(
            target_user.email,
            "space",
            role,
            org_name=org.name,
            workspace_name=ws.name,
            space_name=space.name,
            is_welcome=False,
        )
    briefs = user_briefs(db, [member.user_id])
    out = SpaceMemberOut.model_validate(member)
    out.user = briefs.get(member.user_id)
    return out


@router.delete("/spaces/{space_id}/members/{user_id}", response_model=Message)
def remove_space_member(
    space_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_space_admin(space_id)
    member = db.scalar(select(SpaceMember).where(SpaceMember.space_id == space_id, SpaceMember.user_id == user_id))
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    space = perms.get_space_or_404(space_id)
    ws = perms.get_workspace_or_404(space.workspace_id)
    from app.services.role_hierarchy_service import assert_actor_can_manage_member

    assert_actor_can_manage_member(db, perms, ws.organization_id, user_id)
    if member.role == "admin":
        admin_count = db.scalar(
            select(func.count(SpaceMember.id)).where(
                SpaceMember.space_id == space_id,
                SpaceMember.role == "admin",
            )
        ) or 0
        can_bypass = perms._is_org_admin_or_owner(ws.organization_id) or perms.workspace_role(
            space.workspace_id
        ) in ("admin", "owner")
        if admin_count <= 1 and not can_bypass:
            raise HTTPException(status_code=403, detail="Cannot remove the only space admin")
    db.delete(member)
    db.commit()
    return Message(detail="Member removed")


# ---------------- Space Invites ----------------

@router.get("/spaces/{space_id}/invites", response_model=list[InviteOut])
def list_space_invites(
    space_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.models.invite import Invite
    perms.require_space_admin(space_id)
    invites = db.scalars(
        select(Invite).where(Invite.space_id == space_id, Invite.status == "pending")
    ).all()
    return invites


@router.post("/spaces/{space_id}/invites", response_model=InviteOut, status_code=201)
def create_space_invite(
    space_id: uuid.UUID,
    body: SpaceInviteRequest,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    space = perms.require_space_admin(space_id)
    from app.models.workspace import Workspace as WS
    workspace = db.get(WS, space.workspace_id)
    invite = invite_service.create_invite(
        db,
        inviter=perms.user,
        email=body.email,
        scope="space",
        role=body.role,
        organization_id=workspace.organization_id,
        workspace_id=space.workspace_id,
        space_id=space_id,
    )
    db.commit()
    return invite


@router.get("/spaces/{space_id}/member-candidates", response_model=list[WorkspaceMemberCandidateOut])
def list_space_member_candidates(
    space_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Org members assignable to this space or its projects (excludes org leaders)."""
    space = perms.require_space_admin(space_id)
    ws = perms.get_workspace_or_404(space.workspace_id)
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
        # Show every workspace the candidate belongs to across the org (not just this
        # space's workspace) so their roles elsewhere are visible in the picker.
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

        # Gather space/project roles org-wide (not only this space) so a person's full
        # role set renders identically in every picker across the organization.
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
            project_rows_by_user.setdefault(uid, []).append(
                (proj_id, proj_name, proj_role, sp_id)
            )

    result: list[WorkspaceMemberCandidateOut] = []
    for om in candidate_oms:
        uid = om.user_id
        result.append(
            WorkspaceMemberCandidateOut(
                user_id=uid,
                user=briefs.get(uid),
                org_role=om.role,
                workspaces=[
                    WorkspaceMembershipBrief(
                        workspace_id=ws_id, workspace_name=ws_name, role=ws_role
                    )
                    for ws_id, ws_name, ws_role in ws_rows_by_user.get(uid, [])
                ],
                spaces=[
                    SpaceMembershipBrief(space_id=sp_id, space_name=sp_name, role=sp_role)
                    for sp_id, sp_name, sp_role in space_rows_by_user.get(uid, [])
                ],
                projects=[
                    ProjectMembershipBrief(
                        project_id=proj_id,
                        project_name=proj_name,
                        space_id=sp_id,
                        role=proj_role,
                    )
                    for proj_id, proj_name, proj_role, sp_id in project_rows_by_user.get(uid, [])
                ],
            )
        )
    return result


@router.post("/spaces/{space_id}/invites/bulk", response_model=ScopedBulkInviteOut, status_code=201)
@limiter.limit("20/minute")
def create_space_bulk_invites(
    request: Request,
    space_id: uuid.UUID,
    body: ScopedBulkInviteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    space = perms.require_space_admin(space_id)
    ws = perms.get_workspace_or_404(space.workspace_id)
    grant_payloads: list[dict] = []
    for grant in body.grants:
        if grant.scope != "project":
            raise HTTPException(status_code=400, detail="Space bulk invites only support project grants")
        project = perms.require_project_admin(grant.project_id)
        if project.space_id != space_id:
            raise HTTPException(status_code=400, detail="Project does not belong to this space")
        grant_payloads.append(
            {
                "scope": "project",
                "role": grant.role,
                "workspace_id": space.workspace_id,
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
    return ScopedBulkInviteOut(
        invites=[InviteOut.model_validate(i) for i in invites],
        skipped=skipped,
    )


@router.delete("/spaces/{space_id}/invites/{invite_id}", response_model=Message)
def revoke_space_invite(
    space_id: uuid.UUID,
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.models.invite import Invite
    perms.require_space_admin(space_id)
    invite = db.scalar(select(Invite).where(Invite.id == invite_id, Invite.space_id == space_id))
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = "revoked"
    db.commit()
    return Message(detail="Invite revoked")


# ---------------- Projects ----------------

def _project_out(
    db: Session,
    project: Project,
    my_role: str | None,
    *,
    my_explicit_role: str | None = None,
) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.my_role = my_role
    out.my_explicit_role = my_explicit_role
    out.task_count = db.scalar(
        select(func.count(Task.id)).where(
            Task.project_id == project.id, Task.deleted_at.is_(None),
            Task.is_archived.is_(False), Task.parent_task_id.is_(None),
        )
    )
    out.done_task_count = db.scalar(
        select(func.count(Task.id)).where(
            Task.project_id == project.id, Task.deleted_at.is_(None),
            Task.is_archived.is_(False), Task.parent_task_id.is_(None),
            Task.completed_at.is_not(None),
        )
    )
    return out


@router.get("/spaces/{space_id}/dashboard", response_model=SpaceDashboardOut)
def space_dashboard(
    space_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return build_space_dashboard(db, perms, space_id)


@router.get("/workspaces/{workspace_id}/projects", response_model=list[ProjectOut])
@pat_allow(
    "projects:read",
    rate_category="standard",
    authz_class="workspace",
    tenant_resolution="Path workspace → organization; membership",
)
def list_projects(
    workspace_id: uuid.UUID,
    space_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_member(workspace_id)
    # Workspace-level or org-level admin → sees everything
    is_ws_admin = (
        perms.workspace_role(workspace_id) in ("admin", "owner")
        or perms.org_role(ws.organization_id) in ("owner", "admin")
    )
    # Space admin ids for this user (used for both filtering and role resolution)
    admin_space_ids: set[uuid.UUID] = set()
    if not is_ws_admin:
        admin_space_ids = set(db.scalars(
            select(SpaceMember.space_id).where(
                SpaceMember.user_id == perms.user.id,
                SpaceMember.role == "admin",
            )
        ).all())

    query = select(Project).where(
        Project.workspace_id == workspace_id,
        Project.deleted_at.is_(None),
        Project.is_personal.is_(False),
    )
    if space_id:
        query = query.where(Project.space_id == space_id)
    if not is_ws_admin:
        member_project_ids = select(ProjectMember.project_id).where(
            ProjectMember.user_id == perms.user.id
        )
        conditions = [Project.id.in_(member_project_ids)]
        if admin_space_ids:
            conditions.append(Project.space_id.in_(admin_space_ids))
        query = query.where(or_(*conditions))

    projects = db.scalars(query.order_by(Project.position, Project.created_at)).all()
    # Explicit role map (for members with ProjectMember rows)
    explicit_roles = {
        pm.project_id: pm.role
        for pm in db.scalars(
            select(ProjectMember).where(ProjectMember.user_id == perms.user.id)
        ).all()
    }

    def effective_role(p: Project) -> str | None:
        if is_ws_admin:
            return "admin"
        if p.space_id and p.space_id in admin_space_ids:
            return "admin"
        return explicit_roles.get(p.id)

    return [_project_out(db, p, effective_role(p), my_explicit_role=explicit_roles.get(p.id)) for p in projects]


@router.post("/spaces/{space_id}/projects", response_model=ProjectOut, status_code=201)
def create_project(
    space_id: uuid.UUID,
    body: ProjectCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    space = db.get(Space, space_id)
    if not space or space.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Space not found")
    # Space admin can create projects within their space; workspace admin can always
    if not perms._is_space_admin(space_id):
        perms.require_workspace_admin(space.workspace_id)
    ws = db.get(Workspace, space.workspace_id)
    project = Project(
        space_id=space_id,
        workspace_id=space.workspace_id,
        name=body.name,
        description=body.description,
        color=body.color,
        icon=body.icon,
        created_by=perms.user.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=perms.user.id, role="admin"))
    for name, color, category, position in DEFAULT_STATUSES:
        db.add(CustomStatus(project_id=project.id, name=name, color=color, category=category, position=position))
    db.add(TaskList(project_id=project.id, name="Tasks", position=0, created_by=perms.user.id))
    log_activity(db, workspace_id=space.workspace_id, action="project.created",
                 actor_id=perms.user.id, project_id=project.id, data={"name": project.name})
    audit(db, "project.created", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="project", target_id=project.id, data={"name": project.name})
    db.commit()
    webhook_service.enqueue_event(
        db, ws.organization_id, "project.created",
        {
            "project_id": str(project.id),
            "workspace_id": str(project.workspace_id),
            "name": project.name,
            "created_by": str(perms.user.id),
        },
    )
    return _project_out(db, project, "admin", my_explicit_role="admin")


@router.get("/projects/{project_id}/dashboard", response_model=ProjectDashboardOut)
def project_dashboard(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return build_project_dashboard(db, perms, project_id)


@router.get("/projects/{project_id}/member-dashboard", response_model=ProjectMemberDashboardOut)
def project_member_dashboard(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return build_project_member_dashboard(db, perms, project_id)


@router.get("/projects/{project_id}", response_model=ProjectOut)
@pat_allow(
    "projects:read",
    rate_category="standard",
    authz_class="project",
    tenant_resolution="Path project → workspace → org; project access",
)
def get_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_view(project_id)
    return _project_out(
        db,
        project,
        perms.effective_project_role(project_id),
        my_explicit_role=perms.project_role(project_id),
    )


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        ws = perms.get_workspace_or_404(project.workspace_id)
        perms.require_org_admin(ws.organization_id)
    newly_archived = changes.get("is_archived") is True and not project.is_archived
    if newly_archived:
        project.archived_at = datetime.now(timezone.utc)
    for field, value in changes.items():
        setattr(project, field, value)
    log_activity(db, workspace_id=project.workspace_id, action="project.updated",
                 actor_id=perms.user.id, project_id=project.id, data={"fields": list(changes)})
    db.commit()
    webhook_service.enqueue_workspace_event(
        db, project.workspace_id,
        "project.archived" if newly_archived else "project.updated",
        {
            "project_id": str(project.id),
            "workspace_id": str(project.workspace_id),
            "name": project.name,
            "fields": list(changes),
        },
    )
    return _project_out(
        db,
        project,
        perms.effective_project_role(project_id),
        my_explicit_role=perms.project_role(project_id),
    )


@router.delete("/projects/{project_id}", response_model=Message)
def delete_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.get_project_or_404(project_id)
    ws = perms.require_workspace_admin(project.workspace_id)
    project.deleted_at = datetime.now(timezone.utc)
    audit(db, "project.deleted", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="project", target_id=project.id, data={"name": project.name})
    db.commit()
    return Message(detail="Project deleted")


# ---------------- Project members ----------------

def _ensure_creator_project_admin(db: Session, project: Project) -> None:
    """Backfill: project creators are always explicit admins in the members list."""
    if not project.created_by:
        return
    exists = db.scalar(
        select(ProjectMember.id).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == project.created_by,
        )
    )
    if exists:
        return
    db.add(ProjectMember(project_id=project.id, user_id=project.created_by, role="admin"))
    db.commit()


def _implicit_project_access_block(
    db: Session,
    project: Project,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
) -> str | None:
    """When set, the user already has admin access via a higher scope and cannot be added explicitly."""
    in_org = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == user_id,
        )
    )
    if not in_org:
        return "User is not part of this organization. Send them an invitation instead."
    if in_org.role in ("owner", "admin"):
        return "This user is an org admin and already has full access to all projects automatically."
    target_ws = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == project.workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if target_ws and target_ws.role in ("admin", "owner"):
        return "This user is a workspace admin and already has full access to all projects in this workspace."
    if project.space_id:
        target_sm = db.scalar(
            select(SpaceMember).where(
                SpaceMember.space_id == project.space_id,
                SpaceMember.user_id == user_id,
            )
        )
        if target_sm and target_sm.role == "admin":
            return "This user is a space admin and already has full access to all projects in this space."
    return None


@router.get("/projects/{project_id}/member-candidates", response_model=list[ProjectMemberCandidateOut])
def list_project_member_candidates(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Org members who can be added to this project (excludes implicit admins and existing members)."""
    project = perms.require_project_admin(project_id)
    ws_org = perms.get_workspace_or_404(project.workspace_id).organization_id
    member_ids = set(
        db.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
        ).all()
    )
    ws_member_ids = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(
                WorkspaceMember.workspace_id == project.workspace_id
            )
        ).all()
    )
    org_members = db.scalars(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == ws_org)
        .order_by(OrganizationMember.created_at)
    ).all()
    from app.services.member_candidates import assignable_org_members

    briefs = user_briefs(db, [m.user_id for m in org_members])
    out: list[ProjectMemberCandidateOut] = []
    for om in assignable_org_members(org_members):
        if om.user_id in member_ids:
            continue
        out.append(
            ProjectMemberCandidateOut(
                user_id=om.user_id,
                user=briefs.get(om.user_id),
                in_workspace=om.user_id in ws_member_ids,
            )
        )
    return out


@router.get("/projects/{project_id}/members", response_model=list[ProjectMemberOut])
def list_project_members(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    project = perms.get_project_or_404(project_id)
    _ensure_creator_project_admin(db, project)
    members = db.scalars(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.created_at)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    result = []
    for m in members:
        out = ProjectMemberOut.model_validate(m)
        out.user = briefs.get(m.user_id)
        result.append(out)
    return result


@router.get("/projects/{project_id}/members/{member_user_id}/access", response_model=MemberAccessDetail)
def get_project_member_access(
    project_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Role breakdown for a member within a project (project admin or higher)."""
    project = perms.require_project_admin(project_id)
    ws = perms.get_workspace_or_404(project.workspace_id)
    return build_member_access_detail(
        db,
        perms,
        ws.organization_id,
        member_user_id,
        project_id=project_id,
    )


@router.post("/projects/{project_id}/members", response_model=ProjectMemberOut, status_code=201)
def add_project_member(
    project_id: uuid.UUID,
    body: ProjectMemberAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    ws_org = perms.get_workspace_or_404(project.workspace_id).organization_id
    from app.services.role_hierarchy_service import (
        assert_actor_can_manage_member,
        rank_for_project_role,
    )

    assert_actor_can_manage_member(
        db,
        perms,
        ws_org,
        body.user_id,
        grant_rank=rank_for_project_role(body.role),
    )
    in_org = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == ws_org,
            OrganizationMember.user_id == body.user_id,
        )
    )
    if not in_org:
        raise HTTPException(
            status_code=400,
            detail="User is not part of this organization. Send them an invitation instead.",
        )
    if db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == body.user_id
        )
    ):
        raise HTTPException(status_code=409, detail="User is already a project member")
    member = ProjectMember(project_id=project_id, user_id=body.user_id, role=body.role)
    db.add(member)
    # Ensure workspace membership for visibility
    workspace_member_added = False
    if not db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == project.workspace_id,
            WorkspaceMember.user_id == body.user_id,
        )
    ):
        db.add(WorkspaceMember(workspace_id=project.workspace_id, user_id=body.user_id, role="member"))
        workspace_member_added = True
    db.flush()
    channel_updates = (
        sync_public_channel_members(db, project.workspace_id, {body.user_id})
        if workspace_member_added
        else []
    )
    log_activity(db, workspace_id=project.workspace_id, action="project.member_added",
                 actor_id=perms.user.id, project_id=project_id, data={"user_id": str(body.user_id)})
    db.commit()
    emit_public_channel_member_updates(project.workspace_id, channel_updates, perms.user.id)
    target_user = db.get(User, body.user_id)
    org = db.get(Organization, ws_org)
    if target_user and org:
        email_service.send_role_access_email(
            target_user.email,
            "project",
            body.role,
            org_name=org.name,
            project_name=project.name,
            is_welcome=False,
        )
    out = ProjectMemberOut.model_validate(member)
    out.user = user_briefs(db, [member.user_id]).get(member.user_id)
    return out


@router.patch("/projects/{project_id}/members/{member_user_id}", response_model=ProjectMemberOut)
def update_project_member_role(
    project_id: uuid.UUID,
    member_user_id: uuid.UUID,
    body: ProjectMemberRoleUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    ws = perms.get_workspace_or_404(project.workspace_id)
    from app.services.role_hierarchy_service import (
        assert_actor_can_manage_member,
        rank_for_project_role,
    )

    assert_actor_can_manage_member(
        db,
        perms,
        ws.organization_id,
        member_user_id,
        grant_rank=rank_for_project_role(body.role),
    )
    if member.role == "admin" and body.role != "admin":
        admin_count = db.scalar(
            select(func.count(ProjectMember.id)).where(
                ProjectMember.project_id == project_id,
                ProjectMember.role == "admin",
            )
        ) or 0
        if admin_count <= 1 and not perms._is_org_admin_or_owner(ws.organization_id):
            raise HTTPException(status_code=403, detail="Cannot demote the only project admin")
    old_role = member.role
    if old_role == body.role:
        out = ProjectMemberOut.model_validate(member)
        out.user = user_briefs(db, [member.user_id]).get(member.user_id)
        return out
    member.role = body.role
    log_activity(
        db,
        workspace_id=project.workspace_id,
        action="project.member_role_changed",
        actor_id=perms.user.id,
        project_id=project_id,
        data={"user_id": str(member_user_id), "old_role": old_role, "role": body.role},
    )
    notify(
        db,
        member_user_id,
        "project_role_changed",
        "Your project role changed",
        f"Your role in {project.name} changed from {old_role} to {body.role}.",
        data={
            "project_id": str(project_id),
            "old_role": old_role,
            "role": body.role,
            "actor_id": str(perms.user.id),
        },
        workspace_id=project.workspace_id,
    )
    db.commit()
    target_user = db.get(User, member_user_id)
    org = db.get(Organization, ws.organization_id)
    if target_user and org:
        email_service.send_role_access_email(
            target_user.email,
            "project",
            body.role,
            org_name=org.name,
            project_name=project.name,
            is_welcome=False,
        )
    out = ProjectMemberOut.model_validate(member)
    out.user = user_briefs(db, [member.user_id]).get(member.user_id)
    return out


@router.delete("/projects/{project_id}/members/{member_user_id}", response_model=Message)
def remove_project_member(
    project_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == member_user_id
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    ws = perms.get_workspace_or_404(project.workspace_id)
    from app.services.role_hierarchy_service import assert_actor_can_manage_member

    assert_actor_can_manage_member(db, perms, ws.organization_id, member_user_id)
    if member.role == "admin":
        admin_count = db.scalar(
            select(func.count(ProjectMember.id)).where(
                ProjectMember.project_id == project_id,
                ProjectMember.role == "admin",
            )
        ) or 0
        if admin_count <= 1 and not perms._is_org_admin_or_owner(ws.organization_id):
            raise HTTPException(status_code=403, detail="Cannot remove the only project admin")
    db.delete(member)
    log_activity(db, workspace_id=project.workspace_id, action="project.member_removed",
                 actor_id=perms.user.id, project_id=project_id, data={"user_id": str(member_user_id)})
    db.commit()
    return Message(detail="Member removed")


def _project_team_out(db: Session, link: ProjectTeam) -> ProjectTeamOut:
    team = db.get(Team, link.team_id)
    member_count = db.scalar(
        select(func.count(TeamMember.user_id)).where(TeamMember.team_id == link.team_id)
    ) or 0
    return ProjectTeamOut(
        id=link.id,
        project_id=link.project_id,
        team_id=link.team_id,
        team_name=team.name if team else "",
        team_color=team.color if team else "#8C5BFF",
        default_role=link.default_role,
        member_count=member_count,
        assigned_by=link.assigned_by,
        created_at=link.created_at,
    )


@router.get("/projects/{project_id}/teams", response_model=list[ProjectTeamOut])
def list_project_teams(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    links = db.scalars(
        select(ProjectTeam)
        .where(ProjectTeam.project_id == project_id)
        .order_by(ProjectTeam.created_at)
    ).all()
    return [_project_team_out(db, link) for link in links]


@router.post("/projects/{project_id}/teams", response_model=ProjectTeamAssignResult, status_code=201)
def assign_project_team(
    project_id: uuid.UUID,
    body: ProjectTeamAssign,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    ws = perms.get_workspace_or_404(project.workspace_id)
    result = assign_team_to_project(
        db,
        project=project,
        team_id=body.team_id,
        role=body.role,
        actor_id=perms.user.id,
        organization_id=ws.organization_id,
    )
    link = db.scalar(
        select(ProjectTeam).where(
            ProjectTeam.project_id == project_id,
            ProjectTeam.team_id == body.team_id,
        )
    )
    log_activity(
        db,
        workspace_id=project.workspace_id,
        action="project.team_assigned",
        actor_id=perms.user.id,
        project_id=project_id,
        data={
            "team_id": str(body.team_id),
            "team_name": result.team_name,
            "members_added": result.members_added,
            "role": body.role,
        },
    )
    db.commit()
    return ProjectTeamAssignResult(
        team_id=result.team_id,
        team_name=result.team_name,
        members_added=result.members_added,
        members_skipped=result.members_skipped,
        members_ineligible=result.members_ineligible,
        assignment=_project_team_out(db, link),
    )


@router.post("/projects/{project_id}/invites", response_model=InviteOut, status_code=201)
@limiter.limit("20/minute")
def create_project_invite(
    request: Request,
    project_id: uuid.UUID,
    body: ProjectInviteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_can_invite_to_project(project_id)
    ws = perms.get_workspace_or_404(project.workspace_id)
    invite = invite_service.create_invite(
        db, inviter=perms.user, email=body.email, scope="project",
        role=body.role, organization_id=ws.organization_id,
        workspace_id=project.workspace_id, project_id=project_id,
    )
    return InviteOut.model_validate(invite)


@router.post("/projects/{project_id}/invites/bulk", response_model=ScopedBulkInviteOut, status_code=201)
@limiter.limit("20/minute")
def create_project_bulk_invites(
    request: Request,
    project_id: uuid.UUID,
    body: ScopedBulkInviteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    anchor = perms.require_project_admin(project_id)
    ws = perms.get_workspace_or_404(anchor.workspace_id)
    grant_payloads: list[dict] = []
    for grant in body.grants:
        if grant.scope != "project":
            raise HTTPException(status_code=400, detail="Project bulk invites only support project grants")
        project = perms.require_project_admin(grant.project_id)
        if project.workspace_id != anchor.workspace_id:
            raise HTTPException(status_code=400, detail="Project does not belong to this workspace")
        grant_payloads.append(
            {
                "scope": "project",
                "role": grant.role,
                "workspace_id": anchor.workspace_id,
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
    return ScopedBulkInviteOut(
        invites=[InviteOut.model_validate(i) for i in invites],
        skipped=skipped,
    )


# ---------------- Task lists ----------------

@router.get("/projects/{project_id}/lists", response_model=list[TaskListOut])
def list_task_lists(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    lists = db.scalars(
        select(TaskList)
        .where(TaskList.project_id == project_id, TaskList.deleted_at.is_(None))
        .order_by(TaskList.position, TaskList.created_at)
    ).all()
    return [TaskListOut.model_validate(l) for l in lists]


@router.post("/projects/{project_id}/lists", response_model=TaskListOut, status_code=201)
def create_task_list(
    project_id: uuid.UUID,
    body: TaskListCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    max_pos = db.scalar(
        select(func.coalesce(func.max(TaskList.position), -1)).where(TaskList.project_id == project_id)
    )
    task_list = TaskList(project_id=project_id, name=body.name, position=max_pos + 1, created_by=perms.user.id)
    db.add(task_list)
    db.flush()
    log_activity(db, workspace_id=project.workspace_id, action="list.created",
                 actor_id=perms.user.id, project_id=project_id, data={"name": body.name})
    db.commit()
    return TaskListOut.model_validate(task_list)


@router.patch("/lists/{list_id}", response_model=TaskListOut)
def update_task_list(
    list_id: uuid.UUID,
    body: TaskListUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task_list = db.get(TaskList, list_id)
    if not task_list or task_list.deleted_at is not None:
        raise HTTPException(status_code=404, detail="List not found")
    perms.require_project_admin(task_list.project_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(task_list, field, value)
    db.commit()
    return TaskListOut.model_validate(task_list)


@router.delete("/lists/{list_id}", response_model=Message)
def delete_task_list(
    list_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task_list = db.get(TaskList, list_id)
    if not task_list or task_list.deleted_at is not None:
        raise HTTPException(status_code=404, detail="List not found")
    perms.require_project_admin(task_list.project_id)
    task_list.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Message(detail="List deleted")


# ---------------- Custom statuses ----------------

@router.get("/projects/{project_id}/statuses", response_model=list[CustomStatusOut])
@pat_allow(
    "projects:read",
    rate_category="standard",
    authz_class="project",
    tenant_resolution="Path project → workspace → org; project access",
)
def list_statuses(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    statuses = db.scalars(
        select(CustomStatus)
        .where(CustomStatus.project_id == project_id)
        .order_by(CustomStatus.position)
    ).all()
    return [CustomStatusOut.model_validate(s) for s in statuses]


@router.post("/projects/{project_id}/statuses", response_model=CustomStatusOut, status_code=201)
def create_status(
    project_id: uuid.UUID,
    body: CustomStatusCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_admin(project_id)
    max_pos = db.scalar(
        select(func.coalesce(func.max(CustomStatus.position), -1)).where(
            CustomStatus.project_id == project_id
        )
    )
    status = CustomStatus(
        project_id=project_id, name=body.name, color=body.color,
        category=body.category, position=max_pos + 1,
    )
    db.add(status)
    db.commit()
    return CustomStatusOut.model_validate(status)


@router.patch("/statuses/{status_id}", response_model=CustomStatusOut)
def update_status(
    status_id: uuid.UUID,
    body: CustomStatusUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    status = db.get(CustomStatus, status_id)
    if not status:
        raise HTTPException(status_code=404, detail="Status not found")
    perms.require_project_admin(status.project_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(status, field, value)
    db.commit()
    return CustomStatusOut.model_validate(status)


@router.delete("/statuses/{status_id}", response_model=Message)
def delete_status(
    status_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    status = db.get(CustomStatus, status_id)
    if not status:
        raise HTTPException(status_code=404, detail="Status not found")
    perms.require_project_admin(status.project_id)
    in_use = db.scalar(select(func.count(Task.id)).where(Task.status_id == status_id))
    if in_use:
        raise HTTPException(status_code=409, detail=f"{in_use} task(s) still use this status")
    db.delete(status)
    db.commit()
    return Message(detail="Status deleted")


# ---------------- Activity feed ----------------

@router.get("/projects/{project_id}/activity", response_model=Page[ActivityOut])
def project_activity(
    project_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    base = select(ActivityLog).where(ActivityLog.project_id == project_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    logs = db.scalars(
        base.order_by(ActivityLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    briefs = user_briefs(db, [l.actor_id for l in logs if l.actor_id])
    items = []
    for log in logs:
        out = ActivityOut.model_validate(log)
        out.actor = briefs.get(log.actor_id) if log.actor_id else None
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)
