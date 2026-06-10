import json
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.models.github import GithubEvent, GithubInstallation, GithubRepository
from app.schemas.common import Message, Page
from app.schemas.github import (
    GithubEventOut,
    InstallationCreate,
    InstallationOut,
    RepositoryConnect,
    RepositoryOut,
)
from app.services import github_service
from app.services.audit_service import audit
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/github", tags=["github"])


@router.post("/webhook", include_in_schema=False)
async def github_webhook(
    request: Request,
    x_github_event: str | None = Header(default=None),
    x_github_delivery: str | None = Header(default=None),
    x_hub_signature_256: str | None = Header(default=None),
):
    raw = await request.body()
    if not github_service.verify_signature(raw, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    if x_github_event not in ("push", "pull_request", "issues", "ping"):
        return {"stored": 0, "ignored": x_github_event}
    if x_github_event == "ping":
        return {"ok": True}

    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        stored = github_service.process_event(db, x_github_event, x_github_delivery, payload)
    finally:
        db.close()
    return {"stored": stored}


@router.post("/organizations/{org_id}/installations", response_model=InstallationOut, status_code=201)
def register_installation(
    org_id: uuid.UUID,
    body: InstallationCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    existing = db.scalar(
        select(GithubInstallation).where(GithubInstallation.installation_id == body.installation_id)
    )
    if existing:
        raise HTTPException(status_code=409, detail="This installation is already registered")
    installation = GithubInstallation(
        organization_id=org_id,
        installation_id=body.installation_id,
        account_login=body.account_login,
        account_type=body.account_type,
        installed_by=perms.user.id,
    )
    db.add(installation)
    audit(db, "github.installation_added", organization_id=org_id, actor_id=perms.user.id,
          data={"account": body.account_login})
    db.commit()
    return InstallationOut.model_validate(installation)


@router.get("/organizations/{org_id}/installations", response_model=list[InstallationOut])
def list_installations(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_member(org_id)
    rows = db.scalars(
        select(GithubInstallation).where(
            GithubInstallation.organization_id == org_id,
            GithubInstallation.deleted_at.is_(None),
        )
    ).all()
    return [InstallationOut.model_validate(i) for i in rows]


@router.post("/repositories", response_model=RepositoryOut, status_code=201)
def connect_repository(
    body: RepositoryConnect,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    installation = db.get(GithubInstallation, body.installation_id)
    if not installation or installation.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Installation not found")
    perms.require_org_member(installation.organization_id)
    if body.project_id:
        project = perms.require_project_admin(body.project_id)
        workspace_id = project.workspace_id
    elif body.workspace_id:
        perms.require_workspace_admin(body.workspace_id)
        workspace_id = body.workspace_id
    else:
        raise HTTPException(status_code=422, detail="Provide a project_id or workspace_id to connect")
    repo = GithubRepository(
        installation_id=installation.id,
        workspace_id=workspace_id,
        project_id=body.project_id,
        repo_id=body.repo_id,
        repo_full_name=body.repo_full_name,
        default_branch=body.default_branch,
        connected_by=perms.user.id,
    )
    db.add(repo)
    audit(db, "github.repository_connected", organization_id=installation.organization_id,
          actor_id=perms.user.id, data={"repo": body.repo_full_name})
    db.commit()
    return RepositoryOut.model_validate(repo)


@router.get("/projects/{project_id}/repositories", response_model=list[RepositoryOut])
def project_repositories(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    rows = db.scalars(
        select(GithubRepository).where(
            GithubRepository.project_id == project_id,
            GithubRepository.deleted_at.is_(None),
        )
    ).all()
    return [RepositoryOut.model_validate(r) for r in rows]


@router.delete("/repositories/{repo_id}", response_model=Message)
def disconnect_repository(
    repo_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    repo = db.get(GithubRepository, repo_id)
    if not repo or repo.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Repository not found")
    if repo.project_id:
        perms.require_project_admin(repo.project_id)
    elif repo.workspace_id:
        perms.require_workspace_admin(repo.workspace_id)
    repo.is_active = False
    installation = db.get(GithubInstallation, repo.installation_id)
    audit(db, "github.repository_disconnected",
          organization_id=installation.organization_id if installation else None,
          actor_id=perms.user.id, data={"repo": repo.repo_full_name})
    db.commit()
    return Message(detail="Repository disconnected")


@router.get("/projects/{project_id}/events", response_model=Page[GithubEventOut])
def project_github_events(
    project_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    repo_ids = select(GithubRepository.id).where(GithubRepository.project_id == project_id)
    base = select(GithubEvent).where(GithubEvent.repository_id.in_(repo_ids))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(GithubEvent.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(
        items=[GithubEventOut.model_validate(e) for e in rows],
        total=total, page=page, page_size=page_size,
    )
