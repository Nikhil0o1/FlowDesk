import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.security import generate_token, hash_token, invite_token_expiry
from app.models.invite import Invite
from app.models.organization import Organization, OrganizationMember
from app.models.project import Project, ProjectMember, Space, SpaceMember, TaskList
from app.models.user import Profile, User
from app.models.workspace import Workspace, WorkspaceMember
from app.services import email_service
from app.services.audit_service import audit
from app.services.chat_service import emit_public_channel_member_updates, sync_public_channel_members
from app.services.notification_service import notify


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Roles that may be granted per invite scope. Endpoint schemas validate this too;
# kept here as defense in depth so no caller can mint e.g. an org owner via a
# workspace-scoped invite.
VALID_SCOPE_ROLES = {
    "organization": ("owner", "admin", "member"),  # "owner" only via superadmin create-org flow
    "workspace": ("admin", "member"),
    "space": ("admin", "member"),
    "project": ("admin", "member", "viewer"),
}


def _display_name(user: User) -> str:
    if user.profile and user.profile.full_name:
        return user.profile.full_name
    return user.email


def _inviter_label(inviter: User) -> str:
    """How the inviter appears in emails. Platform superadmins send as the product team."""
    if inviter.is_platform_superadmin:
        return f"The {email_service.BRAND} team"
    return _display_name(inviter)


@dataclass
class _PreparedInvite:
    invite: Invite
    raw_token: str
    scope: str
    role: str
    target_name: str
    workspace_id: uuid.UUID | None
    project_id: uuid.UUID | None
    workspace_name: str | None = None
    space_name: str | None = None
    project_name: str | None = None


def _membership_conflict(
    db: Session,
    *,
    existing_user: User | None,
    scope: str,
    organization_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
    space_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
) -> str | None:
    """Return a skip reason when the user is already a member, else None."""
    if not existing_user:
        return None
    if scope == "organization" and db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == existing_user.id,
        )
    ):
        return "User is already a member of this organization"
    if scope == "workspace" and workspace_id and db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == existing_user.id,
        )
    ):
        return "User is already a member of this workspace"
    if scope == "space" and space_id and db.scalar(
        select(SpaceMember).where(
            SpaceMember.space_id == space_id,
            SpaceMember.user_id == existing_user.id,
        )
    ):
        return "User is already a member of this space"
    if scope == "project" and project_id and db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == existing_user.id,
        )
    ):
        return "User is already a member of this project"
    return None


def _org_membership_conflict(
    db: Session,
    *,
    existing_user: User | None,
    scope: str,
    organization_id: uuid.UUID,
) -> str | None:
    if not existing_user:
        return None
    if scope == "organization":
        if db.scalar(select(OrganizationMember).where(OrganizationMember.user_id == existing_user.id)):
            return "This user already belongs to an organization. Users can only be part of one organization."
        return None
    if db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.user_id == existing_user.id,
            OrganizationMember.organization_id != organization_id,
        )
    ):
        return "This user already belongs to a different organization."
    return None


def _prepare_invite(
    db: Session,
    *,
    inviter: User,
    email: str,
    scope: str,
    role: str,
    organization_id: uuid.UUID,
    workspace_id: uuid.UUID | None = None,
    space_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    existing_user: User | None = None,
) -> _PreparedInvite | str:
    """Create a pending invite row without committing or sending email.

    Returns a skip reason string when the target is already granted, otherwise
    the prepared invite payload.
    """
    if role not in VALID_SCOPE_ROLES.get(scope, ()):
        raise HTTPException(status_code=422, detail=f"Role '{role}' is not valid for {scope} invites")
    email = email.lower().strip()
    org = db.get(Organization, organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if existing_user is None:
        existing_user = db.scalar(select(User).where(User.email == email, User.deleted_at.is_(None)))

    skip = _membership_conflict(
        db,
        existing_user=existing_user,
        scope=scope,
        organization_id=organization_id,
        workspace_id=workspace_id,
        space_id=space_id,
        project_id=project_id,
    )
    if skip:
        return skip
    org_skip = _org_membership_conflict(
        db, existing_user=existing_user, scope=scope, organization_id=organization_id
    )
    if org_skip:
        raise HTTPException(status_code=409, detail=org_skip)

    db.execute(
        update(Invite)
        .where(
            Invite.email == email,
            Invite.status == "pending",
            Invite.organization_id == organization_id,
            Invite.workspace_id.is_(workspace_id) if workspace_id is None else Invite.workspace_id == workspace_id,
            Invite.space_id.is_(space_id) if space_id is None else Invite.space_id == space_id,
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
        space_id=space_id,
        project_id=project_id,
        expires_at=invite_token_expiry(),
        existing_user_id=existing_user.id if existing_user else None,
    )
    db.add(invite)

    workspace = db.get(Workspace, workspace_id) if workspace_id else None
    space = db.get(Space, space_id) if space_id else None
    project = db.get(Project, project_id) if project_id else None
    target_name = (
        project.name if project
        else space.name if space
        else workspace.name if workspace
        else org.name
    )
    return _PreparedInvite(
        invite=invite,
        raw_token=raw_token,
        scope=scope,
        role=role,
        target_name=target_name,
        workspace_id=workspace_id,
        project_id=project_id,
        workspace_name=workspace.name if workspace else None,
        space_name=space.name if space else None,
        project_name=project.name if project else None,
    )


def _notify_existing_user_invite(
    db: Session,
    *,
    inviter: User,
    prepared: _PreparedInvite,
    existing_user: User,
) -> None:
    inviter_name = _inviter_label(inviter)
    notify(
        db,
        existing_user.id,
        "workspace_invite" if prepared.scope == "workspace"
        else "space_invite" if prepared.scope == "space"
        else "project_invite",
        f"{inviter_name} invited you to {prepared.target_name}",
        "Accept the invitation from your email or the notification center.",
        data={"invite_id": str(prepared.invite.id), "scope": prepared.scope},
        workspace_id=prepared.workspace_id,
        project_id=prepared.project_id,
    )


def _send_single_invite_email(
    *,
    email: str,
    inviter: User,
    prepared: _PreparedInvite,
    org_name: str,
    existing_user: User | None,
    db: Session,
) -> None:
    inviter_name = _inviter_label(inviter)
    if existing_user:
        email_service.send_existing_user_invite_email(
            email,
            prepared.scope,
            prepared.role,
            inviter_name,
            prepared.raw_token,
            org_name,
            prepared.target_name,
            db=db,
            sender_id=inviter.id,
        )
        return

    email_service.send_new_user_invite_email(
        email,
        org_name,
        inviter_name,
        prepared.raw_token,
        scope=prepared.scope,
        role=prepared.role,
        workspace_name=prepared.workspace_name,
        space_name=prepared.space_name,
        project_name=prepared.project_name,
        db=db,
        sender_id=inviter.id,
    )


def _send_role_access_for_invite(db: Session, invite: Invite, *, is_welcome: bool) -> None:
    """Template 2 — role summary email for an accepted invite."""
    org = db.get(Organization, invite.organization_id)
    if not org:
        return
    workspace = db.get(Workspace, invite.workspace_id) if invite.workspace_id else None
    space = db.get(Space, invite.space_id) if invite.space_id else None
    project = db.get(Project, invite.project_id) if invite.project_id else None
    if space and not workspace:
        workspace = db.get(Workspace, space.workspace_id)
    if project and not workspace:
        workspace = db.get(Workspace, project.workspace_id)
    email_service.send_role_access_email(
        invite.email,
        invite.scope,
        invite.role,
        org_name=org.name,
        workspace_name=workspace.name if workspace else None,
        space_name=space.name if space else None,
        project_name=project.name if project else None,
        is_welcome=is_welcome,
    )


def create_invite(
    db: Session,
    *,
    inviter: User,
    email: str,
    scope: str,  # organization | workspace | space | project
    role: str,
    organization_id: uuid.UUID,
    workspace_id: uuid.UUID | None = None,
    space_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> Invite:
    """Create an invite and send the appropriate email (onboarding vs accept)."""
    prepared = _prepare_invite(
        db,
        inviter=inviter,
        email=email,
        scope=scope,
        role=role,
        organization_id=organization_id,
        workspace_id=workspace_id,
        space_id=space_id,
        project_id=project_id,
    )
    if isinstance(prepared, str):
        raise HTTPException(status_code=409, detail=prepared)

    org = db.get(Organization, organization_id)
    existing_user = db.scalar(
        select(User).where(User.email == prepared.invite.email, User.deleted_at.is_(None))
    )

    audit(
        db,
        "invite.created",
        organization_id=organization_id,
        actor_id=inviter.id,
        target_type="invite",
        target_id=prepared.invite.email,
        data={"scope": scope, "role": role},
    )

    _send_single_invite_email(
        email=prepared.invite.email,
        inviter=inviter,
        prepared=prepared,
        org_name=org.name if org else "",
        existing_user=existing_user,
        db=db,
    )
    if existing_user:
        _notify_existing_user_invite(db, inviter=inviter, prepared=prepared, existing_user=existing_user)

    db.commit()
    db.refresh(prepared.invite)
    return prepared.invite


def create_invites_bulk(
    db: Session,
    *,
    inviter: User,
    email: str,
    organization_id: uuid.UUID,
    grants: list[dict],
) -> tuple[list[Invite], list[str]]:
    """Create multiple scoped invites for one email and send a single consolidated message."""
    if not grants:
        raise HTTPException(status_code=422, detail="At least one invite target is required")

    email_norm = email.lower().strip()
    existing_user = db.scalar(select(User).where(User.email == email_norm, User.deleted_at.is_(None)))
    org = db.get(Organization, organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    prepared: list[_PreparedInvite] = []
    skipped: list[str] = []
    seen: set[tuple[str, uuid.UUID | None, uuid.UUID | None, uuid.UUID | None]] = set()

    for grant in grants:
        scope = grant["scope"]
        role = grant["role"]
        workspace_id = grant.get("workspace_id")
        space_id = grant.get("space_id")
        project_id = grant.get("project_id")
        key = (scope, workspace_id, space_id, project_id)
        if key in seen:
            continue
        seen.add(key)

        result = _prepare_invite(
            db,
            inviter=inviter,
            email=email_norm,
            scope=scope,
            role=role,
            organization_id=organization_id,
            workspace_id=workspace_id,
            space_id=space_id,
            project_id=project_id,
            existing_user=existing_user,
        )
        if isinstance(result, str):
            skipped.append(result)
            continue
        prepared.append(result)

    if not prepared:
        raise HTTPException(
            status_code=409,
            detail=skipped[0] if len(skipped) == 1 else "No invitations could be created for this user",
        )

    inviter_name = _inviter_label(inviter)
    for item in prepared:
        audit(
            db,
            "invite.created",
            organization_id=organization_id,
            actor_id=inviter.id,
            target_type="invite",
            target_id=item.invite.email,
            data={"scope": item.scope, "role": item.role, "bulk": True},
        )

    if existing_user:
        email_service.send_bulk_existing_user_invite_email(
            email_norm,
            inviter_name,
            org.name,
            [
                (p.scope, p.role, p.target_name, p.raw_token)
                for p in prepared
            ],
            db=db,
            sender_id=inviter.id,
        )
        for item in prepared:
            _notify_existing_user_invite(db, inviter=inviter, prepared=item, existing_user=existing_user)
    else:
        email_service.send_bulk_new_user_invite_email(
            email_norm,
            inviter_name,
            org.name,
            [
                (p.scope, p.role, p.target_name, p.raw_token)
                for p in prepared
            ],
            db=db,
            sender_id=inviter.id,
        )

    db.commit()
    for item in prepared:
        db.refresh(item.invite)
    return [item.invite for item in prepared], skipped


def get_valid_invite(db: Session, raw_token: str) -> Invite:
    invite = db.scalar(
        select(Invite)
        .where(Invite.token_hash == hash_token(raw_token))
        .with_for_update()
    )
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=400, detail="This invitation is invalid or has been used")
    if invite.expires_at <= _now():
        invite.status = "expired"
        db.commit()
        raise HTTPException(status_code=400, detail="This invitation has expired")
    return invite


def _consume_invite(db: Session, invite: Invite) -> None:
    """Mark an invite accepted exactly once (race-safe)."""
    result = db.execute(
        update(Invite)
        .where(Invite.id == invite.id, Invite.status == "pending")
        .values(status="accepted", accepted_at=_now())
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="This invitation has already been used")


def preview_invite(db: Session, raw_token: str) -> dict:
    invite = db.scalar(select(Invite).where(Invite.token_hash == hash_token(raw_token)))
    if not invite or invite.status not in ("pending", "expired"):
        raise HTTPException(status_code=400, detail="This invitation is invalid or has been used")
    org = db.get(Organization, invite.organization_id)
    target_name = org.name if org else ""
    if invite.project_id:
        project = db.get(Project, invite.project_id)
        target_name = project.name if project else target_name
    elif invite.space_id:
        space = db.get(Space, invite.space_id)
        target_name = space.name if space else target_name
    elif invite.workspace_id:
        workspace = db.get(Workspace, invite.workspace_id)
        target_name = workspace.name if workspace else target_name
    existing_user = invite.existing_user_id is not None or db.scalar(
        select(User).where(User.email == invite.email, User.deleted_at.is_(None))
    ) is not None
    return {
        "email": invite.email,
        "scope": invite.scope,
        "role": invite.role,
        "organization_name": org.name if org else "",
        "target_name": target_name,
        "existing_user": existing_user,
        "expired": invite.status == "expired" or invite.expires_at <= _now(),
    }


def _grant_memberships(db: Session, invite: Invite, user: User) -> set[uuid.UUID]:
    """Grant scoped memberships for an accepted invite (idempotent)."""
    # autoflush is off in production: flush so memberships granted by a previous
    # invite in the same activation (bulk invites) are visible to the existence
    # checks below instead of being duplicated.
    db.flush()
    affected_workspace_ids: set[uuid.UUID] = set()
    # Everyone in a workspace/project must at least be an org member
    org_member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == invite.organization_id,
            OrganizationMember.user_id == user.id,
        )
    )
    if not org_member:
        if db.scalar(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.organization_id != invite.organization_id,
            )
        ):
            raise HTTPException(status_code=409, detail="User already belongs to a different organization.")
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

    # Org owner accepts: auto-add them as admin to the bootstrapped default workspace
    if invite.scope == "organization" and invite.role == "owner":
        default_workspaces = db.scalars(
            select(Workspace).where(
                Workspace.organization_id == invite.organization_id,
                Workspace.deleted_at.is_(None),
            )
        ).all()
        for ws in default_workspaces:
            affected_workspace_ids.add(ws.id)
            if not db.scalar(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == ws.id,
                    WorkspaceMember.user_id == user.id,
                )
            ):
                db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="admin"))

    if invite.scope == "workspace" and invite.workspace_id:
        affected_workspace_ids.add(invite.workspace_id)
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

    if invite.scope == "space" and invite.space_id:
        space = db.get(Space, invite.space_id)
        if space:
            affected_workspace_ids.add(space.workspace_id)
            if not db.scalar(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == space.workspace_id,
                    WorkspaceMember.user_id == user.id,
                )
            ):
                db.add(WorkspaceMember(workspace_id=space.workspace_id, user_id=user.id, role="member"))
        if not db.scalar(
            select(SpaceMember).where(
                SpaceMember.space_id == invite.space_id,
                SpaceMember.user_id == user.id,
            )
        ):
            db.add(SpaceMember(space_id=invite.space_id, user_id=user.id, role=invite.role))

    if invite.scope == "project" and invite.project_id:
        project = db.get(Project, invite.project_id)
        if project:
            affected_workspace_ids.add(project.workspace_id)
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
    return affected_workspace_ids


def activate_invite(db: Session, raw_token: str, full_name: str) -> User:
    """New-user activation (passwordless): creates the account and grants access.
    The user then signs in via SSO or an email one-time code. Single-use token.

    A single activation link unlocks EVERY pending invite for this email in the
    same organization (the bulk invite email sends one activation link for all
    places), so the new user never has to click a separate link per place."""
    invite = get_valid_invite(db, raw_token)
    existing = db.scalar(select(User).where(User.email == invite.email, User.deleted_at.is_(None)))
    if existing:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists. Use the accept-invitation flow instead.",
        )

    user = User(
        email=invite.email,
        is_active=True,
        email_verified_at=_now(),
        auth_provider="invite",
    )
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, full_name=full_name.strip()))

    # Gather every pending invite for this email in the same org (includes the
    # primary token's invite) so one activation grants all of them together.
    pending = db.scalars(
        select(Invite)
        .where(
            Invite.email == invite.email,
            Invite.organization_id == invite.organization_id,
            Invite.status == "pending",
        )
        .with_for_update()
    ).all()
    invites_by_id: dict[uuid.UUID, Invite] = {inv.id: inv for inv in pending}
    invites_by_id[invite.id] = invite

    affected_workspace_ids: set[uuid.UUID] = set()
    granted: list[Invite] = []
    for inv in invites_by_id.values():
        if inv.expires_at <= _now():
            inv.status = "expired"
            continue
        affected_workspace_ids |= _grant_memberships(db, inv, user)
        granted.append(inv)

    channel_updates: dict[uuid.UUID, list[uuid.UUID]] = {
        workspace_id: sync_public_channel_members(db, workspace_id, {user.id})
        for workspace_id in affected_workspace_ids
    }
    for inv in granted:
        _consume_invite(db, inv)

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
        data={"scope": invite.scope, "new_user": True, "granted": len(granted)},
    )
    db.commit()
    for workspace_id, channel_ids in channel_updates.items():
        emit_public_channel_member_updates(workspace_id, channel_ids, user.id)
    # No separate welcome email here: the onboarding invite email already carried
    # the "Welcome to {org}" message + activation button, so the new user gets a
    # single email rather than an invite followed by a duplicate welcome.
    db.refresh(user)
    return user


def _finalize_acceptance(db: Session, invite: Invite, user: User) -> Invite:
    """Grant memberships for an existing user accepting an invite. Shared by the
    token-based (email link) and id-based (in-app notification) accept flows.
    The invite.email == user.email check is the real authorization in both."""
    if invite.email != user.email:
        raise HTTPException(status_code=403, detail="This invitation was sent to a different email address")
    affected_workspace_ids = _grant_memberships(db, invite, user)
    channel_updates: dict[uuid.UUID, list[uuid.UUID]] = {
        workspace_id: sync_public_channel_members(db, workspace_id, {user.id})
        for workspace_id in affected_workspace_ids
    }
    _consume_invite(db, invite)
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
    for workspace_id, channel_ids in channel_updates.items():
        emit_public_channel_member_updates(workspace_id, channel_ids, user.id)
    _send_role_access_for_invite(db, invite, is_welcome=False)
    return invite


def accept_invite(db: Session, raw_token: str, user: User) -> Invite:
    """Existing-user accept via the email-link token."""
    invite = get_valid_invite(db, raw_token)
    return _finalize_acceptance(db, invite, user)


def get_valid_invite_by_id(db: Session, invite_id: uuid.UUID) -> Invite:
    invite = db.get(Invite, invite_id)
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=400, detail="This invitation is invalid or has been used")
    if invite.expires_at <= _now():
        invite.status = "expired"
        db.commit()
        raise HTTPException(status_code=400, detail="This invitation has expired")
    return invite


def accept_invite_by_id(db: Session, invite_id: uuid.UUID, user: User) -> Invite:
    """Existing-user accept from the in-app notification. No raw token needed —
    the authenticated session plus the email match authorize it."""
    invite = get_valid_invite_by_id(db, invite_id)
    return _finalize_acceptance(db, invite, user)


def preview_invite_for_user(db: Session, invite_id: uuid.UUID, user: User) -> dict:
    """Preview an invite addressed to the authenticated user (by id). Backs the
    in-app notification flow, which carries the invite id instead of the token."""
    invite = db.get(Invite, invite_id)
    if not invite or invite.email != user.email:
        raise HTTPException(status_code=404, detail="Invitation not found")
    org = db.get(Organization, invite.organization_id)
    target_name = org.name if org else ""
    if invite.project_id:
        project = db.get(Project, invite.project_id)
        target_name = project.name if project else target_name
    elif invite.space_id:
        space = db.get(Space, invite.space_id)
        target_name = space.name if space else target_name
    elif invite.workspace_id:
        workspace = db.get(Workspace, invite.workspace_id)
        target_name = workspace.name if workspace else target_name
    return {
        "email": invite.email,
        "scope": invite.scope,
        "role": invite.role,
        "organization_name": org.name if org else "",
        "target_name": target_name,
        "existing_user": True,
        "expired": invite.status != "pending" or invite.expires_at <= _now(),
    }
