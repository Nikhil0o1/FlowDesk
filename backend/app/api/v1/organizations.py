import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.core.pat_route_registry import pat_allow
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.invite import Invite
from app.models.organization import Organization, OrganizationMember
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.organization import (
    AuditLogOut,
    InviteCreate,
    InviteOut,
    MemberAccessDetail,
    OrganizationBulkInviteCreate,
    OrganizationBulkInviteOut,
    OrganizationOut,
    OrganizationUpdate,
    OrgMemberOut,
    OrgMemberRoleUpdate,
    TransferOwnershipRequest,
)
from app.schemas.dashboard import OrgDashboardOut
from app.services import email_service, invite_service
from app.services.audit_service import audit
from app.services.dashboard_service import build_org_dashboard
from app.services.member_access_service import build_member_access_detail
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get("", response_model=list[OrganizationOut])
@pat_allow(
    "organizations:read",
    rate_category="standard",
    authz_class="principal",
    tenant_resolution="Membership-filtered org list for PAT user",
)
def list_my_organizations(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = db.execute(
        select(Organization, OrganizationMember.role)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(
            OrganizationMember.user_id == user.id,
            Organization.deleted_at.is_(None),
        )
        .order_by(Organization.created_at)
    ).all()
    result = []
    for org, role in rows:
        out = OrganizationOut.model_validate(org)
        out.my_role = role
        result.append(out)
    return result


@router.get("/{org_id}", response_model=OrganizationOut)
def get_organization(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    role = perms.require_org_member(org_id)
    out = OrganizationOut.model_validate(perms.get_org_or_404(org_id))
    out.my_role = role
    return out


@router.get("/{org_id}/dashboard", response_model=OrgDashboardOut)
def org_dashboard(
    org_id: uuid.UUID,
    days: int = Query(7, ge=7, le=90),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_member(org_id)
    return build_org_dashboard(db, perms, org_id, days=days)


@router.patch("/{org_id}", response_model=OrganizationOut)
def update_organization(
    org_id: uuid.UUID,
    body: OrganizationUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    org = perms.get_org_or_404(org_id)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(org, field, value)
    audit(db, "organization.updated", organization_id=org_id, actor_id=perms.user.id, data={"fields": list(changes)})
    db.commit()
    out = OrganizationOut.model_validate(org)
    out.my_role = "owner"
    return out


@router.get("/{org_id}/members", response_model=list[OrgMemberOut])
def list_members(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_member(org_id)
    members = db.scalars(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == org_id)
        .order_by(OrganizationMember.created_at)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    result = []
    for m in members:
        out = OrgMemberOut.model_validate(m)
        out.user = briefs.get(m.user_id)
        result.append(out)
    return result


@router.get("/{org_id}/members/{member_user_id}/access", response_model=MemberAccessDetail)
def get_member_access(
    org_id: uuid.UUID,
    member_user_id: uuid.UUID,
    workspace_id: uuid.UUID | None = Query(default=None),
    space_id: uuid.UUID | None = Query(default=None),
    project_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Full role breakdown and access directory for a single org member."""
    return build_member_access_detail(
        db,
        perms,
        org_id,
        member_user_id,
        workspace_id=workspace_id,
        space_id=space_id,
        project_id=project_id,
    )


@router.patch("/{org_id}/members/{member_user_id}", response_model=Message)
def update_member_role(
    org_id: uuid.UUID,
    member_user_id: uuid.UUID,
    body: OrgMemberRoleUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.services.role_hierarchy_service import (
        assert_actor_can_manage_member,
        rank_for_org_role,
    )

    perms.require_org_admin(org_id)
    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=422, detail="Role must be admin or member. Use transfer-ownership to change the owner.")
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot change the owner's role. Use transfer-ownership instead.")
    assert_actor_can_manage_member(db, perms, org_id, member_user_id, grant_rank=rank_for_org_role(body.role))
    member.role = body.role
    # Org owners/admins are members of every general/public channel across the org.
    from app.models.workspace import Workspace
    from app.services.chat_service import prune_public_channel_members, sync_public_channel_members

    ws_ids = db.scalars(
        select(Workspace.id).where(
            Workspace.organization_id == org_id,
            Workspace.deleted_at.is_(None),
        )
    ).all()
    for ws_id in ws_ids:
        if body.role in ("owner", "admin"):
            # Promotion: add the leader to every workspace's channels immediately.
            sync_public_channel_members(db, ws_id, {member_user_id})
        else:
            # Demotion: keep them in workspaces they actually belong to; drop them from
            # general channels where they were present only as an org leader.
            prune_public_channel_members(db, ws_id, {member_user_id})
    audit(
        db, "member.role_changed", organization_id=org_id, actor_id=perms.user.id,
        target_type="user", target_id=member_user_id, data={"role": body.role},
    )
    db.commit()
    org = db.get(Organization, org_id)
    target_user = db.get(User, member_user_id)
    if org and target_user:
        email_service.send_role_access_email(
            target_user.email,
            "organization",
            body.role,
            org_name=org.name,
            is_welcome=False,
        )
    return Message(detail="Role updated")


@router.delete("/{org_id}/members/{member_user_id}", response_model=Message)
def remove_member(
    org_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.services.role_hierarchy_service import assert_actor_can_manage_member

    perms.require_org_admin(org_id)
    assert_actor_can_manage_member(db, perms, org_id, member_user_id)
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove the organization owner. Transfer ownership first.")
    db.delete(member)
    audit(
        db, "member.removed", organization_id=org_id, actor_id=perms.user.id,
        target_type="user", target_id=member_user_id,
    )
    db.commit()
    return Message(detail="Member removed")


@router.post("/{org_id}/invites", response_model=InviteOut, status_code=201)
@limiter.limit("20/minute")
def create_org_invite(
    request: Request,
    org_id: uuid.UUID,
    body: InviteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=422, detail="Role must be admin or member")
    invite = invite_service.create_invite(
        db, inviter=perms.user, email=body.email, scope="organization",
        role=body.role, organization_id=org_id,
    )
    return InviteOut.model_validate(invite)


@router.post("/{org_id}/invites/bulk", response_model=OrganizationBulkInviteOut, status_code=201)
@limiter.limit("20/minute")
def create_org_bulk_invites(
    request: Request,
    org_id: uuid.UUID,
    body: OrganizationBulkInviteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_member(org_id)
    grant_payloads: list[dict] = []
    for grant in body.grants:
        if grant.scope == "workspace":
            ws = perms.require_can_invite_to_workspace(grant.workspace_id)
            if ws.organization_id != org_id:
                raise HTTPException(status_code=400, detail="Workspace does not belong to this organization")
            if grant.role == "admin" and perms.org_role(org_id) not in ("owner", "admin"):
                raise HTTPException(
                    status_code=403,
                    detail="Only an organization admin or owner can invite new workspace admins",
                )
            grant_payloads.append(
                {
                    "scope": "workspace",
                    "role": grant.role,
                    "workspace_id": grant.workspace_id,
                    "space_id": None,
                    "project_id": None,
                }
            )
        elif grant.scope == "space":
            space = perms.require_space_admin(grant.space_id)
            ws = perms.get_workspace_or_404(space.workspace_id)
            if ws.organization_id != org_id:
                raise HTTPException(status_code=400, detail="Space does not belong to this organization")
            grant_payloads.append(
                {
                    "scope": "space",
                    "role": grant.role,
                    "workspace_id": space.workspace_id,
                    "space_id": grant.space_id,
                    "project_id": None,
                }
            )
        else:
            project = perms.require_project_admin(grant.project_id)
            ws = perms.get_workspace_or_404(project.workspace_id)
            if ws.organization_id != org_id:
                raise HTTPException(status_code=400, detail="Project does not belong to this organization")
            grant_payloads.append(
                {
                    "scope": "project",
                    "role": grant.role,
                    "workspace_id": project.workspace_id,
                    "space_id": None,
                    "project_id": grant.project_id,
                }
            )

    invites, skipped = invite_service.create_invites_bulk(
        db,
        inviter=perms.user,
        email=body.email,
        organization_id=org_id,
        grants=grant_payloads,
    )
    return OrganizationBulkInviteOut(
        invites=[InviteOut.model_validate(i) for i in invites],
        skipped=skipped,
    )


@router.get("/{org_id}/invites", response_model=list[InviteOut])
def list_org_invites(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    invites = db.scalars(
        select(Invite)
        .where(Invite.organization_id == org_id, Invite.status == "pending")
        .order_by(Invite.created_at.desc())
    ).all()
    return [InviteOut.model_validate(i) for i in invites]


@router.delete("/{org_id}/invites/{invite_id}", response_model=Message)
def revoke_invite(
    org_id: uuid.UUID,
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    invite = db.get(Invite, invite_id)
    if not invite or invite.organization_id != org_id:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = "revoked"
    audit(db, "invite.revoked", organization_id=org_id, actor_id=perms.user.id, target_id=invite.email)
    db.commit()
    return Message(detail="Invite revoked")


@router.post("/{org_id}/transfer-ownership", response_model=Message)
def transfer_ownership(
    org_id: uuid.UUID,
    body: TransferOwnershipRequest,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    if body.new_owner_id == perms.user.id:
        raise HTTPException(status_code=400, detail="You are already the owner")
    new_owner_member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == body.new_owner_id,
        )
    )
    if not new_owner_member:
        raise HTTPException(status_code=404, detail="User is not a member of this organization")
    current_owner_member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == perms.user.id,
        )
    )
    current_owner_member.role = "admin"
    new_owner_member.role = "owner"
    audit(
        db, "organization.ownership_transferred", organization_id=org_id,
        actor_id=perms.user.id, target_type="user", target_id=body.new_owner_id,
        data={"from": str(perms.user.id), "to": str(body.new_owner_id)},
    )
    db.commit()
    return Message(detail="Ownership transferred successfully")


@router.get("/{org_id}/audit-logs", response_model=Page[AuditLogOut])
def org_audit_logs(
    org_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    base = select(AuditLog).where(AuditLog.organization_id == org_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    logs = db.scalars(
        base.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    briefs = user_briefs(db, [l.actor_id for l in logs if l.actor_id])
    items = []
    for log in logs:
        out = AuditLogOut.model_validate(log)
        out.actor = briefs.get(log.actor_id) if log.actor_id else None
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)
