"""Organization member access directory and role resolution."""
from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space, SpaceMember
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.dashboard import (
    ProjectRoleItem,
    SpaceRoleItem,
    UserRoleSummary,
    WorkspaceRoleItem,
)
from app.schemas.organization import (
    MemberAccessDetail,
    ProjectAccessItem,
    SpaceAccessItem,
    WorkspaceAccessItem,
)
from app.services.permission_service import NotFound404, PermissionError403, PermissionService
from app.services.role_hierarchy_service import (
    highest_role_from_parts as _highest_role_from_parts,
    resolve_user_highest_role,
    role_rank,
)
from app.services.user_service import user_briefs


def assert_actor_can_view_member(
    db: Session,
    perms: PermissionService,
    org_id: uuid.UUID,
    target_user_id: uuid.UUID,
    *,
    workspace_id: uuid.UUID | None = None,
    space_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> None:
    """Authorize using the same scoped-admin rules as dashboards and member lists."""
    scope_count = sum(x is not None for x in (workspace_id, space_id, project_id))
    if scope_count > 1:
        raise HTTPException(status_code=422, detail="Only one scope filter may be set")

    if workspace_id is not None:
        ws = perms.require_workspace_admin(workspace_id)
        if ws.organization_id != org_id:
            raise NotFound404("Workspace not found")
        if not db.scalar(
            select(WorkspaceMember.id).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == target_user_id,
            )
        ):
            raise PermissionError403("Member is outside your scope")
        return

    if space_id is not None:
        space = perms.require_space_admin(space_id)
        ws = perms.get_workspace_or_404(space.workspace_id)
        if ws.organization_id != org_id:
            raise NotFound404("Space not found")
        if not db.scalar(
            select(SpaceMember.id).where(
                SpaceMember.space_id == space_id,
                SpaceMember.user_id == target_user_id,
            )
        ):
            raise PermissionError403("Member is outside your scope")
        return

    if project_id is not None:
        project = perms.require_project_admin(project_id)
        ws = perms.get_workspace_or_404(project.workspace_id)
        if ws.organization_id != org_id:
            raise NotFound404("Project not found")
        if not db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == target_user_id,
            )
        ):
            raise PermissionError403("Member is outside your scope")
        return

    perms.require_people_directory_access(org_id)


def _filter_member_access_detail(
    detail: MemberAccessDetail,
    *,
    workspace_id: uuid.UUID | None = None,
    space_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> MemberAccessDetail:
    if project_id is not None:
        return detail.model_copy(
            update={
                "workspace_access": [],
                "space_access": [],
                "project_access": [
                    p for p in detail.project_access if p.project_id == project_id
                ],
            }
        )
    if space_id is not None:
        return detail.model_copy(
            update={
                "workspace_access": [],
                "space_access": [s for s in detail.space_access if s.space_id == space_id],
                "project_access": [p for p in detail.project_access if p.space_id == space_id],
            }
        )
    if workspace_id is not None:
        return detail.model_copy(
            update={
                "workspace_access": [
                    w for w in detail.workspace_access if w.workspace_id == workspace_id
                ],
                "space_access": [
                    s for s in detail.space_access if s.workspace_id == workspace_id
                ],
                "project_access": [
                    p for p in detail.project_access if p.workspace_id == workspace_id
                ],
            }
        )
    return detail


def resolve_user_roles_for_member(
    db: Session,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    org_name: str,
    org_role: str,
) -> UserRoleSummary:
    """Role summary for a specific org member (not necessarily the actor)."""
    ws_rows = db.execute(
        select(Workspace.id, Workspace.name, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.organization_id == org_id,
            Workspace.deleted_at.is_(None),
            WorkspaceMember.user_id == user_id,
        )
        .order_by(Workspace.name)
    ).all()
    if org_role == "owner":
        workspace_roles = [
            WorkspaceRoleItem(workspace_id=r[0], workspace_name=r[1], role="owner")
            for r in ws_rows
        ]
    else:
        workspace_roles = [
            WorkspaceRoleItem(workspace_id=r[0], workspace_name=r[1], role=r[2])
            for r in ws_rows
        ]

    ws_ids = [r[0] for r in ws_rows]
    space_rows: list = []
    if ws_ids:
        space_rows = list(
            db.execute(
                select(Space.id, Space.name, Workspace.id, Workspace.name, SpaceMember.role)
                .join(SpaceMember, SpaceMember.space_id == Space.id)
                .join(Workspace, Workspace.id == Space.workspace_id)
                .where(
                    Space.workspace_id.in_(ws_ids),
                    Space.deleted_at.is_(None),
                    SpaceMember.user_id == user_id,
                )
                .order_by(Workspace.name, Space.name)
            ).all()
        )
    space_roles = [
        SpaceRoleItem(space_id=r[0], space_name=r[1], workspace_id=r[2], workspace_name=r[3], role=r[4])
        for r in space_rows
    ]

    proj_rows = db.execute(
        select(
            Project.id,
            Project.name,
            Space.name,
            Project.workspace_id,
            ProjectMember.role,
            Project.is_personal,
        )
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .join(Workspace, Workspace.id == Project.workspace_id)
        .outerjoin(Space, Space.id == Project.space_id)
        .where(
            Workspace.organization_id == org_id,
            Project.deleted_at.is_(None),
            Project.is_archived.is_(False),
            ProjectMember.user_id == user_id,
        )
        .order_by(Workspace.name, Project.name)
    ).all()
    project_roles = [
        ProjectRoleItem(
            project_id=r[0],
            project_name=r[1],
            space_name=r[2],
            workspace_id=r[3],
            role=r[4],
            is_personal=bool(r[5]),
        )
        for r in proj_rows
    ]

    highest = _highest_role_from_parts(org_role, workspace_roles, space_roles, project_roles)
    return UserRoleSummary(
        highest_role=highest,
        org_role=org_role,
        org_name=org_name,
        workspace_roles=workspace_roles,
        space_roles=space_roles,
        project_roles=project_roles,
    )


def build_member_access_detail(
    db: Session,
    perms: PermissionService,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    workspace_id: uuid.UUID | None = None,
    space_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> MemberAccessDetail:
    org = perms.get_org_or_404(org_id)
    assert_actor_can_view_member(
        db,
        perms,
        org_id,
        user_id,
        workspace_id=workspace_id,
        space_id=space_id,
        project_id=project_id,
    )

    org_member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == user_id,
        )
    )
    if not org_member:
        raise HTTPException(status_code=404, detail="User is not a member of this organization")

    summary = resolve_user_roles_for_member(
        db, org_id, user_id, org.name, org_member.role
    )
    ws_role_map = {wr.workspace_id: wr.role for wr in summary.workspace_roles}
    space_role_map = {sr.space_id: sr.role for sr in summary.space_roles}
    project_role_map = {pr.project_id: pr.role for pr in summary.project_roles}

    workspaces = db.scalars(
        select(Workspace)
        .where(Workspace.organization_id == org_id, Workspace.deleted_at.is_(None))
        .order_by(Workspace.name)
    ).all()

    workspace_access = [
        WorkspaceAccessItem(
            workspace_id=ws.id,
            workspace_name=ws.name,
            role=ws_role_map.get(ws.id),
        )
        for ws in workspaces
    ]

    ws_id_to_name = {ws.id: ws.name for ws in workspaces}
    if ws_id_to_name:
        spaces = db.scalars(
            select(Space)
            .where(
                Space.workspace_id.in_(list(ws_id_to_name.keys())),
                Space.deleted_at.is_(None),
            )
            .order_by(Space.workspace_id, Space.name)
        ).all()
    else:
        spaces = []

    space_access = [
        SpaceAccessItem(
            space_id=sp.id,
            space_name=sp.name,
            workspace_id=sp.workspace_id,
            workspace_name=ws_id_to_name.get(sp.workspace_id, ""),
            role=space_role_map.get(sp.id),
        )
        for sp in spaces
    ]

    projects = db.scalars(
        select(Project)
        .join(Workspace, Workspace.id == Project.workspace_id)
        .where(
            Workspace.organization_id == org_id,
            Project.deleted_at.is_(None),
            Project.is_archived.is_(False),
        )
        .order_by(Project.workspace_id, Project.name)
    ).all()

    space_names = {sp.id: sp.name for sp in spaces}
    project_access = [
        ProjectAccessItem(
            project_id=p.id,
            project_name=p.name,
            workspace_id=p.workspace_id,
            workspace_name=ws_id_to_name.get(p.workspace_id, ""),
            space_id=p.space_id,
            space_name=space_names.get(p.space_id) if p.space_id else None,
            role=project_role_map.get(p.id),
        )
        for p in projects
    ]

    briefs = user_briefs(db, [user_id])
    actor_org_role = perms.org_role(org_id)
    actor_highest = resolve_user_highest_role(db, org_id, perms.user.id)

    can_manage_org_role = (
        user_id != perms.user.id
        and org_member.role != "owner"
        and role_rank(actor_highest) > role_rank(summary.highest_role)
        and actor_org_role in ("owner", "admin")
    )

    detail = MemberAccessDetail(
        user_id=user_id,
        org_role=org_member.role,
        highest_role=summary.highest_role,
        user=briefs.get(user_id),
        workspace_access=workspace_access,
        space_access=space_access,
        project_access=project_access,
        can_manage_org_role=can_manage_org_role,
    )
    return _filter_member_access_detail(
        detail,
        workspace_id=workspace_id,
        space_id=space_id,
        project_id=project_id,
    )
