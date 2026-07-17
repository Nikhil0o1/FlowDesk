"""Org-wide role hierarchy for people management.

Higher rank can modify members with strictly lower rank. Peers and superiors are protected.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import Organization, OrganizationMember
from app.schemas.dashboard import ProjectRoleItem, SpaceRoleItem, WorkspaceRoleItem
from app.services.permission_service import PermissionError403, PermissionService

# Highest (org owner) → lowest (org member — baseline membership, no scoped elevation)
ROLE_RANK: dict[str, int] = {
    "org_owner": 8,
    "org_admin": 7,
    "workspace_admin": 6,
    "space_admin": 5,
    "project_admin": 4,
    "project_member": 3,
    "project_viewer": 2,
    "org_member": 1,
    "member": 0,
}


def role_rank(highest_role: str) -> int:
    return ROLE_RANK.get(highest_role, 0)


def rank_for_org_role(role: str) -> int:
    if role == "owner":
        return ROLE_RANK["org_owner"]
    if role == "admin":
        return ROLE_RANK["org_admin"]
    return ROLE_RANK["org_member"]


def rank_for_workspace_role(role: str) -> int:
    if role in ("admin", "owner"):
        return ROLE_RANK["workspace_admin"]
    return ROLE_RANK["org_member"]


def rank_for_space_role(role: str) -> int:
    if role == "admin":
        return ROLE_RANK["space_admin"]
    return ROLE_RANK["org_member"]


def rank_for_project_role(role: str) -> int:
    if role == "admin":
        return ROLE_RANK["project_admin"]
    if role == "member":
        return ROLE_RANK["project_member"]
    if role == "viewer":
        return ROLE_RANK["project_viewer"]
    return ROLE_RANK["org_member"]


def highest_role_from_parts(
    org_role: str | None,
    workspace_roles: list[WorkspaceRoleItem],
    space_roles: list[SpaceRoleItem],
    project_roles: list[ProjectRoleItem],
) -> str:
    if org_role == "owner":
        return "org_owner"
    if org_role == "admin":
        return "org_admin"
    if any(wr.role in ("admin", "owner") for wr in workspace_roles):
        return "workspace_admin"
    if any(sr.role == "admin" for sr in space_roles):
        return "space_admin"
    # Personal List admin must not elevate rank / Goals-adjacent "project_admin" status.
    scoped_project_roles = [pr for pr in project_roles if not getattr(pr, "is_personal", False)]
    if any(pr.role == "admin" for pr in scoped_project_roles):
        return "project_admin"
    if any(pr.role == "member" for pr in scoped_project_roles):
        return "project_member"
    if any(pr.role == "viewer" for pr in scoped_project_roles):
        return "project_viewer"
    if org_role == "member":
        return "org_member"
    if workspace_roles or space_roles or project_roles:
        return "member"
    return "member"


def resolve_user_highest_role(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> str:
    from app.services.member_access_service import resolve_user_roles_for_member

    org_member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == user_id,
        )
    )
    if not org_member:
        return "member"
    org = db.get(Organization, org_id)
    org_name = org.name if org else ""
    summary = resolve_user_roles_for_member(
        db, org_id, user_id, org_name, org_member.role
    )
    return summary.highest_role


def can_viewer_see_member_in_analytics(viewer_highest: str, target_highest: str) -> bool:
    """Whether an analytics viewer may see another member who is already in their
    surrounding population (workspace / space / project membership).

    Org owners and org admins see everyone.

    Scoped admins (workspace / space / project) see anyone who belongs in their
    administered surrounding — including another workspace's admin who joined as
    a project/space/workspace member. Only org owner and org admin stay hidden
    from scoped viewers (org-level leaders are never treated as "surrounding peers").
    """
    if viewer_highest in ("org_owner", "org_admin"):
        return True
    if target_highest in ("org_owner", "org_admin"):
        return False
    return True


def assert_actor_can_manage_member(
    db: Session,
    perms: PermissionService,
    org_id: uuid.UUID,
    target_user_id: uuid.UUID,
    *,
    grant_rank: int | None = None,
    allow_self: bool = False,
) -> None:
    """Raise 403 when the actor cannot manage the target (or grant the proposed rank)."""
    if not allow_self and target_user_id == perms.user.id:
        raise PermissionError403("You cannot manage your own role or membership")

    target_org = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == target_user_id,
        )
    )
    if target_org and target_org.role == "owner":
        raise PermissionError403("The organization owner cannot be managed this way")

    actor_highest = resolve_user_highest_role(db, org_id, perms.user.id)
    target_highest = resolve_user_highest_role(db, org_id, target_user_id)
    actor = role_rank(actor_highest)
    target = role_rank(target_highest)

    if actor <= target:
        raise PermissionError403(
            "You cannot manage a member with an equal or higher role than yours"
        )
    if grant_rank is not None:
        if grant_rank > actor:
            raise PermissionError403(
                "You cannot grant a role above your own level"
            )
        if grant_rank == actor and not (
            actor_highest == "project_admin"
            and grant_rank == ROLE_RANK["project_admin"]
        ):
            raise PermissionError403(
                "You cannot grant a role equal to or above your own level"
            )
