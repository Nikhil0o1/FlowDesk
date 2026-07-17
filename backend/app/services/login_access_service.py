"""Login access verification and role-based landing context.

Sign-in is invitation-only: valid credentials are not enough. A user must be a
platform superadmin, hold at least one active organization membership, or have a
pending invite for their email (existing users accepting a new workspace).
"""
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import Organization, OrganizationMember
from app.models.invite import Invite
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember

LOGIN_PERMISSION_MESSAGE = (
    "You do not have permission to sign in. "
    "Access is by invitation only — ask your organization admin for an invite."
)

ORG_DISABLED_MESSAGE = (
    "Your organization has been disabled. "
    "Contact your platform administrator for assistance."
)


class LoginAccessDenied(HTTPException):
    def __init__(self, detail: str = LOGIN_PERMISSION_MESSAGE):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class LoginContext(BaseModel):
    """Resolved from DB memberships — drives post-login routing on the client."""

    kind: str  # platform_superadmin | org_owner | workspace_admin | member
    role: str
    redirect_to: str
    organization_id: str | None = None
    workspace_id: str | None = None
    project_id: str | None = None


def has_pending_invite(db: Session, email: str) -> bool:
    return _has_pending_invite(db, email)


def assert_can_login(db: Session, user: User) -> LoginContext:
    """Raise 403 unless the user is allowed to sign in; return landing context."""
    ctx = resolve_login_context(db, user)
    if ctx is None:
        raise LoginAccessDenied()
    return ctx


def resolve_login_context(db: Session, user: User) -> LoginContext | None:
    if user.is_platform_superadmin:
        return LoginContext(
            kind="platform_superadmin",
            role="superadmin",
            redirect_to="/admin/platform",
        )

    memberships = _active_org_memberships(db, user.id)
    if not memberships:
        if _has_any_org_membership(db, user.id):
            raise LoginAccessDenied(ORG_DISABLED_MESSAGE)
        if _has_pending_invite(db, user.email):
            return LoginContext(
                kind="pending_invite",
                role="invited",
                redirect_to="/app/dashboard",
            )
        return None

    owner_org = next((org for _member, org in memberships if _member.role == "owner"), None)
    if owner_org:
        return LoginContext(
            kind="org_owner",
            role="owner",
            redirect_to="/app/workspaces",
            organization_id=str(owner_org.id),
        )

    ws_admin = _first_workspace_admin(db, user.id)
    if ws_admin:
        return LoginContext(
            kind="workspace_admin",
            role="admin",
            redirect_to=f"/app/workspaces/{ws_admin.id}",
            organization_id=str(ws_admin.organization_id),
            workspace_id=str(ws_admin.id),
        )

    _member, primary_org = memberships[0]
    primary_ws = _first_workspace_in_org(db, user.id, primary_org.id)
    return LoginContext(
        kind="member",
        role="member",
        redirect_to="/app/dashboard",
        organization_id=str(primary_org.id),
        workspace_id=str(primary_ws.id) if primary_ws else None,
    )


def _active_org_memberships(
    db: Session, user_id: uuid.UUID
) -> list[tuple[OrganizationMember, Organization]]:
    rows = db.execute(
        select(OrganizationMember, Organization)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == user_id,
            Organization.deleted_at.is_(None),
            Organization.is_disabled.is_(False),
        )
        .order_by(Organization.created_at)
    ).all()
    return list(rows)


def _has_any_org_membership(db: Session, user_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(OrganizationMember.id)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user_id,
                Organization.deleted_at.is_(None),
            )
            .limit(1)
        )
        is not None
    )


def _first_workspace_admin(db: Session, user_id: uuid.UUID) -> Workspace | None:
    return db.scalar(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .join(Organization, Organization.id == Workspace.organization_id)
        .where(
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.role == "admin",
            Workspace.deleted_at.is_(None),
            Organization.deleted_at.is_(None),
            Organization.is_disabled.is_(False),
        )
        .order_by(Workspace.created_at)
        .limit(1)
    )


def _first_workspace_in_org(
    db: Session, user_id: uuid.UUID, organization_id: uuid.UUID
) -> Workspace | None:
    return db.scalar(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            WorkspaceMember.user_id == user_id,
            Workspace.organization_id == organization_id,
            Workspace.deleted_at.is_(None),
        )
        .order_by(Workspace.created_at)
        .limit(1)
    )


def _has_pending_invite(db: Session, email: str) -> bool:
    now = datetime.now(timezone.utc)
    return (
        db.scalar(
            select(Invite.id)
            .where(
                Invite.email == email.lower().strip(),
                Invite.status == "pending",
                Invite.expires_at > now,
            )
            .limit(1)
        )
        is not None
    )
