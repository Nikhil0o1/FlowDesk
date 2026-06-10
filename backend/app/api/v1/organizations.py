import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
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
    OrganizationOut,
    OrganizationUpdate,
    OrgMemberOut,
    OrgMemberRoleUpdate,
)
from app.services import invite_service
from app.services.audit_service import audit
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get("", response_model=list[OrganizationOut])
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


@router.patch("/{org_id}/members/{member_user_id}", response_model=Message)
def update_member_role(
    org_id: uuid.UUID,
    member_user_id: uuid.UUID,
    body: OrgMemberRoleUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.user_id == perms.user.id and body.role != "owner":
        owners = db.scalar(
            select(func.count(OrganizationMember.id)).where(
                OrganizationMember.organization_id == org_id, OrganizationMember.role == "owner"
            )
        )
        if owners <= 1:
            raise HTTPException(status_code=400, detail="An organization must keep at least one owner")
    member.role = body.role
    audit(
        db, "member.role_changed", organization_id=org_id, actor_id=perms.user.id,
        target_type="user", target_id=member_user_id, data={"role": body.role},
    )
    db.commit()
    return Message(detail="Role updated")


@router.delete("/{org_id}/members/{member_user_id}", response_model=Message)
def remove_member(
    org_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    if member_user_id == perms.user.id:
        raise HTTPException(status_code=400, detail="You cannot remove yourself from the organization")
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == member_user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
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
    perms.require_org_owner(org_id)
    if body.role not in ("owner", "member"):
        raise HTTPException(status_code=422, detail="Role must be owner or member")
    invite = invite_service.create_invite(
        db, inviter=perms.user, email=body.email, scope="organization",
        role=body.role, organization_id=org_id,
    )
    return InviteOut.model_validate(invite)


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
