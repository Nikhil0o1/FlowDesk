"""Platform superadmin panel: organization metadata + platform audit logs ONLY.

Superadmins must never see org-private data (tasks, comments, chat, files).
Every endpoint here returns metadata/aggregates exclusively.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_superadmin
from app.db.session import get_db
from app.models.audit import AuditLog, CronJobLog
from app.models.organization import Organization, OrganizationMember
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.common import Message, Page
from app.schemas.organization import AuditLogOut
from app.services import invite_service
from app.services.audit_service import audit
from app.services.user_service import user_briefs

router = APIRouter(prefix="/admin", tags=["platform-admin"])


class OrgMetadataOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    is_disabled: bool
    plan: str
    seats: int
    created_at: datetime
    member_count: int
    workspace_count: int
    project_count: int
    task_count: int  # aggregate count only — no task content


class OrgCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    slug: str = Field(min_length=2, max_length=120, pattern="^[a-z0-9][a-z0-9-]*$")
    owner_email: EmailStr
    plan: str = Field(default="free", max_length=40)
    seats: int = Field(default=10, ge=1, le=10000)


class PlatformStatsOut(BaseModel):
    organizations: int
    active_organizations: int
    users: int
    workspaces: int


class CronJobLogOut(BaseModel):
    id: uuid.UUID
    job_name: str
    started_at: datetime
    finished_at: datetime | None
    status: str
    items_processed: int
    message: str | None

    model_config = {"from_attributes": True}


def _org_metadata(db: Session, org: Organization) -> OrgMetadataOut:
    member_count = db.scalar(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org.id
        )
    ) or 0
    workspace_ids = select(Workspace.id).where(
        Workspace.organization_id == org.id, Workspace.deleted_at.is_(None)
    )
    workspace_count = db.scalar(
        select(func.count()).select_from(workspace_ids.subquery())
    ) or 0
    project_ids = select(Project.id).where(
        Project.workspace_id.in_(workspace_ids), Project.deleted_at.is_(None)
    )
    project_count = db.scalar(select(func.count()).select_from(project_ids.subquery())) or 0
    task_count = db.scalar(
        select(func.count(Task.id)).where(
            Task.project_id.in_(project_ids), Task.deleted_at.is_(None)
        )
    ) or 0
    return OrgMetadataOut(
        id=org.id, name=org.name, slug=org.slug, is_disabled=org.is_disabled,
        plan=org.plan, seats=org.seats, created_at=org.created_at,
        member_count=member_count, workspace_count=workspace_count,
        project_count=project_count, task_count=task_count,
    )


@router.get("/stats", response_model=PlatformStatsOut)
def platform_stats(db: Session = Depends(get_db), _admin: User = Depends(get_superadmin)):
    return PlatformStatsOut(
        organizations=db.scalar(
            select(func.count(Organization.id)).where(Organization.deleted_at.is_(None))
        ) or 0,
        active_organizations=db.scalar(
            select(func.count(Organization.id)).where(
                Organization.deleted_at.is_(None), Organization.is_disabled.is_(False)
            )
        ) or 0,
        users=db.scalar(
            select(func.count(User.id)).where(User.deleted_at.is_(None))
        ) or 0,
        workspaces=db.scalar(
            select(func.count(Workspace.id)).where(Workspace.deleted_at.is_(None))
        ) or 0,
    )


@router.get("/organizations", response_model=Page[OrgMetadataOut])
def list_all_organizations(
    q: str | None = Query(default=None, max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_superadmin),
):
    base = select(Organization).where(Organization.deleted_at.is_(None))
    if q:
        base = base.where(Organization.name.ilike(f"%{q}%"))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    orgs = db.scalars(
        base.order_by(Organization.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(
        items=[_org_metadata(db, o) for o in orgs],
        total=total, page=page, page_size=page_size,
    )


@router.post("/organizations", response_model=OrgMetadataOut, status_code=201)
def create_organization(
    body: OrgCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_superadmin),
):
    if db.scalar(select(Organization).where(Organization.slug == body.slug)):
        raise HTTPException(status_code=409, detail="Slug is already in use")
    org = Organization(name=body.name, slug=body.slug, plan=body.plan, seats=body.seats)
    db.add(org)
    db.flush()
    audit(db, "organization.created", actor_id=admin.id, target_type="organization",
          target_id=org.id, data={"name": org.name, "owner_email": body.owner_email})
    db.commit()
    # Owner onboarding invite (new or existing user)
    invite_service.create_invite(
        db, inviter=admin, email=body.owner_email, scope="organization",
        role="owner", organization_id=org.id,
    )
    return _org_metadata(db, org)


@router.get("/organizations/{org_id}", response_model=OrgMetadataOut)
def get_organization_metadata(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_superadmin),
):
    org = db.get(Organization, org_id)
    if not org or org.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return _org_metadata(db, org)


@router.post("/organizations/{org_id}/disable", response_model=Message)
def disable_organization(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(get_superadmin),
):
    org = db.get(Organization, org_id)
    if not org or org.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Organization not found")
    org.is_disabled = True
    org.disabled_at = datetime.now(timezone.utc)
    audit(db, "organization.disabled", actor_id=admin.id, target_type="organization", target_id=org_id)
    db.commit()
    return Message(detail=f"Organization '{org.name}' disabled")


@router.post("/organizations/{org_id}/enable", response_model=Message)
def enable_organization(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(get_superadmin),
):
    org = db.get(Organization, org_id)
    if not org or org.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Organization not found")
    org.is_disabled = False
    org.disabled_at = None
    audit(db, "organization.enabled", actor_id=admin.id, target_type="organization", target_id=org_id)
    db.commit()
    return Message(detail=f"Organization '{org.name}' enabled")


@router.get("/audit-logs", response_model=Page[AuditLogOut])
def platform_audit_logs(
    action: str | None = Query(default=None, max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_superadmin),
):
    base = select(AuditLog)
    if action:
        base = base.where(AuditLog.action == action)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    logs = db.scalars(
        base.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    briefs = user_briefs(db, [l.actor_id for l in logs if l.actor_id])
    items = []
    for log in logs:
        out = AuditLogOut.model_validate(log)
        out.actor = briefs.get(log.actor_id) if log.actor_id else None
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/cron-logs", response_model=Page[CronJobLogOut])
def cron_logs(
    job_name: str | None = Query(default=None, max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_superadmin),
):
    base = select(CronJobLog)
    if job_name:
        base = base.where(CronJobLog.job_name == job_name)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(CronJobLog.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(
        items=[CronJobLogOut.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
    )
