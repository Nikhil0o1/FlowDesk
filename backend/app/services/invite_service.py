import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.security import generate_token, hash_password, hash_token, invite_token_expiry
from app.models.invite import Invite
from app.models.organization import Organization, OrganizationMember
from app.models.project import Project, ProjectMember
from app.models.user import Profile, User
from app.models.workspace import Workspace, WorkspaceMember
from app.services import email_service
from app.services.audit_service import audit
from app.services.notification_service import notify


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Roles that may be granted per invite scope. Endpoint schemas validate this too;
# kept here as defense in depth so no caller can mint e.g. an org owner via a
# workspace-scoped invite.
VALID_SCOPE_ROLES = {
    "organization": ("owner", "member"),
    "workspace": ("admin", "member"),
    "project": ("admin", "member", "viewer"),
}


def _display_name(user: User) -> str:
    if user.profile and user.profile.full_name:
        return user.profile.full_name
    return user.email


def create_invite(
    db: Session,
    *,
    inviter: User,
    email: str,
    scope: str,  # organization | workspace | project
    role: str,
    organization_id: uuid.UUID,
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> Invite:
    """Create an invite and send the appropriate email (onboarding vs accept)."""
    if role not in VALID_SCOPE_ROLES.get(scope, ()):
        raise HTTPException(status_code=422, detail=f"Role '{role}' is not valid for {scope} invites")
    email = email.lower().strip()
    org = db.get(Organization, organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    existing_user = db.scalar(select(User).where(User.email == email, User.deleted_at.is_(None)))

    # If they're already a member of the exact target, reject early
    if existing_user:
        if scope == "organization" and db.scalar(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == existing_user.id,
            )
        ):
            raise HTTPException(status_code=409, detail="User is already a member of this organization")
        if scope == "workspace" and workspace_id and db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == existing_user.id,
            )
        ):
            raise HTTPException(status_code=409, detail="User is already a member of this workspace")
        if scope == "project" and project_id and db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == existing_user.id,
            )
        ):
            raise HTTPException(status_code=409, detail="User is already a member of this project")

    # Revoke previous pending invites for the same email + target
    db.execute(
        update(Invite)
        .where(
            Invite.email == email,
            Invite.status == "pending",
            Invite.organization_id == organization_id,
            Invite.workspace_id.is_(workspace_id) if workspace_id is None else Invite.workspace_id == workspace_id,
            Invite.project_id.is_(project_id) if project_id is None else Invite.project_id == project_id,
        )
        .values(status="revoked")
    )

    raw_token = generate_token()
    invite = Invite(
        email=email,
        token_hash=hash_token(raw_token),
        invited_by=inviter.id,
        scope=scope,
        role=role,
        organization_id=organization_id,
        workspace_id=workspace_id,
        project_id=project_id,
        expires_at=invite_token_expiry(),
        existing_user_id=existing_user.id if existing_user else None,
    )
    db.add(invite)

    audit(
        db,
        "invite.created",
        organization_id=organization_id,
        actor_id=inviter.id,
        target_type="invite",
        target_id=email,
        data={"scope": scope, "role": role},
    )

    inviter_name = _display_name(inviter)
    workspace = db.get(Workspace, workspace_id) if workspace_id else None
    project = db.get(Project, project_id) if project_id else None

    if existing_user:
        target_name = (
            project.name if project else workspace.name if workspace else org.name
        )
        email_service.send_existing_user_invite_email(
            email, target_name, scope, inviter_name, raw_token, db=db, sender_id=inviter.id
        )
        notify(
            db,
            existing_user.id,
            "workspace_invite" if scope == "workspace" else "project_invite" if scope == "project" else "workspace_invite",
            f"{inviter_name} invited you to {target_name}",
            f"Accept the invitation from your email or the notification center.",
            data={"invite_token": raw_token, "scope": scope},
            workspace_id=workspace_id,
            project_id=project_id,
        )
    elif scope == "organization":
        email_service.send_owner_onboarding_email(
            email, org.name, inviter_name, raw_token, db=db, sender_id=inviter.id
        )
    elif scope == "workspace":
        email_service.send_workspace_admin_onboarding_email(
            email, workspace.name if workspace else "", org.name, inviter_name, raw_token,
            db=db, sender_id=inviter.id,
        )
    else:
        email_service.send_project_member_onboarding_email(
            email, project.name if project else "", org.name, inviter_name, raw_token,
            db=db, sender_id=inviter.id,
        )

    db.commit()
    db.refresh(invite)
    return invite


def get_valid_invite(db: Session, raw_token: str) -> Invite:
    invite = db.scalar(select(Invite).where(Invite.token_hash == hash_token(raw_token)))
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=400, detail="This invitation is invalid or has been used")
    if invite.expires_at <= _now():
        invite.status = "expired"
        db.commit()
        raise HTTPException(status_code=400, detail="This invitation has expired")
    return invite


def preview_invite(db: Session, raw_token: str) -> dict:
    invite = db.scalar(select(Invite).where(Invite.token_hash == hash_token(raw_token)))
    if not invite or invite.status not in ("pending", "expired"):
        raise HTTPException(status_code=400, detail="This invitation is invalid or has been used")
    org = db.get(Organization, invite.organization_id)
    target_name = org.name if org else ""
    if invite.project_id:
        project = db.get(Project, invite.project_id)
        target_name = project.name if project else target_name
    elif invite.workspace_id:
        workspace = db.get(Workspace, invite.workspace_id)
        target_name = workspace.name if workspace else target_name
    return {
        "email": invite.email,
        "scope": invite.scope,
        "role": invite.role,
        "organization_name": org.name if org else "",
        "target_name": target_name,
        "existing_user": invite.existing_user_id is not None,
        "expired": invite.status == "expired" or invite.expires_at <= _now(),
    }


def _grant_memberships(db: Session, invite: Invite, user: User) -> None:
    """Grant scoped memberships for an accepted invite (idempotent)."""
    # Everyone in a workspace/project must at least be an org member
    org_member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == invite.organization_id,
            OrganizationMember.user_id == user.id,
        )
    )
    if not org_member:
        db.add(
            OrganizationMember(
                organization_id=invite.organization_id,
                user_id=user.id,
                role=invite.role if invite.scope == "organization" else "member",
                joined_at=_now(),
            )
        )
    elif invite.scope == "organization" and invite.role == "owner":
        org_member.role = "owner"

    if invite.scope == "workspace" and invite.workspace_id:
        if not db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == invite.workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        ):
            db.add(
                WorkspaceMember(
                    workspace_id=invite.workspace_id, user_id=user.id, role=invite.role
                )
            )

    if invite.scope == "project" and invite.project_id:
        project = db.get(Project, invite.project_id)
        if project and not db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == project.workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        ):
            db.add(
                WorkspaceMember(workspace_id=project.workspace_id, user_id=user.id, role="member")
            )
        if not db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == invite.project_id,
                ProjectMember.user_id == user.id,
            )
        ):
            db.add(ProjectMember(project_id=invite.project_id, user_id=user.id, role=invite.role))


def activate_invite(db: Session, raw_token: str, full_name: str, password: str) -> User:
    """New-user activation: sets their own password, single-use token."""
    invite = get_valid_invite(db, raw_token)
    existing = db.scalar(select(User).where(User.email == invite.email, User.deleted_at.is_(None)))
    if existing:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists. Use the accept-invitation flow instead.",
        )

    user = User(
        email=invite.email,
        hashed_password=hash_password(password),
        is_active=True,
        email_verified_at=_now(),
        auth_provider="password",
    )
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, full_name=full_name.strip()))

    _grant_memberships(db, invite, user)
    invite.status = "accepted"
    invite.accepted_at = _now()

    notify(
        db,
        user.id,
        "user_onboarded",
        "Welcome to FlowDesk!",
        "Your account is ready. Explore your workspace to get started.",
    )
    audit(
        db,
        "invite.accepted",
        organization_id=invite.organization_id,
        actor_id=user.id,
        target_type="invite",
        target_id=invite.email,
        data={"scope": invite.scope, "new_user": True},
    )
    db.commit()
    db.refresh(user)
    return user


def accept_invite(db: Session, raw_token: str, user: User) -> Invite:
    """Existing-user accept: no password change, just membership grant."""
    invite = get_valid_invite(db, raw_token)
    if invite.email != user.email:
        raise HTTPException(status_code=403, detail="This invitation was sent to a different email address")
    _grant_memberships(db, invite, user)
    invite.status = "accepted"
    invite.accepted_at = _now()
    audit(
        db,
        "invite.accepted",
        organization_id=invite.organization_id,
        actor_id=user.id,
        target_type="invite",
        target_id=invite.email,
        data={"scope": invite.scope, "new_user": False},
    )
    db.commit()
    return invite
