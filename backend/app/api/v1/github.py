import json
import uuid

import jwt
import requests as http_requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.config import settings
from app.db.session import get_db
from app.models.github import GithubEvent, GithubInstallation, GithubOAuthToken, GithubRepository
from app.schemas.common import Message, Page
from app.schemas.github import (
    AvailableRepo,
    GithubEventOut,
    InstallationCreate,
    InstallationOut,
    OAuthStatusOut,
    RepositoryConnect,
    RepositoryOut,
    RepoConnectSimple,
)
from app.services import github_api_service, github_service
from app.services.audit_service import audit
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/github", tags=["github"])


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# OAuth flow
# ---------------------------------------------------------------------------

@router.get("/oauth/authorize")
def github_oauth_authorize(
    org_id: uuid.UUID,
    perms: PermissionService = Depends(get_permissions),
):
    """Return the GitHub OAuth authorization URL. Frontend redirects the browser there."""
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured (GITHUB_CLIENT_ID missing)")
    perms.require_org_member(org_id)
    state = jwt.encode(
        {"org_id": str(org_id), "user_id": str(perms.user.id)},
        settings.SECRET_KEY,
        algorithm="HS256",
    )
    params = (
        f"client_id={settings.GITHUB_CLIENT_ID}"
        f"&scope=repo"
        f"&state={state}"
    )
    return {"url": f"https://github.com/login/oauth/authorize?{params}"}


@router.get("/oauth/callback", include_in_schema=False)
def github_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    """GitHub redirects here after user authorises. Stores token and sends browser back to frontend."""
    frontend = settings.FRONTEND_URL

    if error or not code or not state:
        return RedirectResponse(f"{frontend}/app?github_error=1")

    try:
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=["HS256"])
        org_id = uuid.UUID(payload["org_id"])
        user_id = uuid.UUID(payload["user_id"])
    except Exception:
        return RedirectResponse(f"{frontend}/app?github_error=1")

    # Exchange code for token
    try:
        resp = http_requests.post(
            "https://github.com/login/oauth/access_token",
            json={"client_id": settings.GITHUB_CLIENT_ID, "client_secret": settings.GITHUB_CLIENT_SECRET, "code": code},
            headers={"Accept": "application/json"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return RedirectResponse(f"{frontend}/app?github_error=1")

    access_token = data.get("access_token")
    if not access_token:
        return RedirectResponse(f"{frontend}/app?github_error=1")

    # Get the GitHub user
    try:
        gh_user = github_api_service.get_authenticated_user(access_token)
    except Exception:
        return RedirectResponse(f"{frontend}/app?github_error=1")

    # Upsert the OAuth token
    existing = db.scalar(
        select(GithubOAuthToken).where(GithubOAuthToken.organization_id == org_id)
    )
    if existing:
        existing.access_token = access_token
        existing.scope = data.get("scope", "")
        existing.github_user_login = gh_user["login"]
        existing.github_user_id = gh_user["id"]
        existing.connected_by = user_id
    else:
        db.add(GithubOAuthToken(
            organization_id=org_id,
            access_token=access_token,
            scope=data.get("scope", ""),
            github_user_login=gh_user["login"],
            github_user_id=gh_user["id"],
            connected_by=user_id,
        ))

    # Also upsert a GithubInstallation so webhook processing still works
    inst = db.scalar(
        select(GithubInstallation).where(
            GithubInstallation.organization_id == org_id,
            GithubInstallation.account_login == gh_user["login"],
            GithubInstallation.deleted_at.is_(None),
        )
    )
    if not inst:
        db.add(GithubInstallation(
            organization_id=org_id,
            installation_id=gh_user["id"],
            account_login=gh_user["login"],
            account_type="User" if gh_user.get("type") == "User" else "Organization",
            installed_by=user_id,
        ))

    audit(db, "github.oauth_connected", organization_id=org_id, actor_id=user_id,
          data={"github_login": gh_user["login"]})
    db.commit()
    return RedirectResponse(f"{frontend}/app?github_connected=1")


@router.delete("/oauth/disconnect")
def github_oauth_disconnect(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_owner(org_id)
    token = db.scalar(select(GithubOAuthToken).where(GithubOAuthToken.organization_id == org_id))
    if token:
        db.delete(token)
    audit(db, "github.oauth_disconnected", organization_id=org_id, actor_id=perms.user.id)
    db.commit()
    return Message(detail="GitHub disconnected")


# ---------------------------------------------------------------------------
# OAuth status + available repos
# ---------------------------------------------------------------------------

@router.get("/organizations/{org_id}/oauth-status", response_model=OAuthStatusOut)
def github_oauth_status(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_member(org_id)
    token = db.scalar(select(GithubOAuthToken).where(GithubOAuthToken.organization_id == org_id))
    if not token:
        return OAuthStatusOut(connected=False)
    return OAuthStatusOut(connected=True, github_user_login=token.github_user_login)


@router.get("/organizations/{org_id}/available-repos", response_model=list[AvailableRepo])
def list_available_repos(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_member(org_id)
    token = db.scalar(select(GithubOAuthToken).where(GithubOAuthToken.organization_id == org_id))
    if not token:
        raise HTTPException(status_code=400, detail="GitHub is not connected for this organisation")
    try:
        raw = github_api_service.list_accessible_repos(token.access_token)
    except Exception:
        raise HTTPException(status_code=502, detail="Could not fetch repositories from GitHub")
    return [
        AvailableRepo(
            repo_id=r["id"],
            repo_full_name=r["full_name"],
            default_branch=r.get("default_branch", "main"),
            private=r.get("private", False),
        )
        for r in raw
    ]


# ---------------------------------------------------------------------------
# Simplified connect (OAuth-based) — no manual IDs
# ---------------------------------------------------------------------------

@router.post("/organizations/{org_id}/connect-repo", response_model=RepositoryOut, status_code=201)
def connect_repo_simple(
    org_id: uuid.UUID,
    body: RepoConnectSimple,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Connect a repo to a project using only the repo full name. Auto-fetches repo ID and creates webhook."""
    perms.require_org_member(org_id)
    token = db.scalar(select(GithubOAuthToken).where(GithubOAuthToken.organization_id == org_id))
    if not token:
        raise HTTPException(status_code=400, detail="GitHub is not connected for this organisation")

    project = perms.require_project_view(body.project_id)

    # Fetch repo details from GitHub
    try:
        owner, repo_name = body.repo_full_name.split("/", 1)
        gh_repo = github_api_service.get_repo(token.access_token, owner, repo_name)
    except Exception:
        raise HTTPException(status_code=502, detail="Could not fetch repository details from GitHub")

    # Find or create the installation record
    inst = db.scalar(
        select(GithubInstallation).where(
            GithubInstallation.organization_id == org_id,
            GithubInstallation.deleted_at.is_(None),
        )
    )
    if not inst:
        raise HTTPException(status_code=400, detail="No GitHub installation found. Please reconnect GitHub.")

    # Auto-create webhook on the repo
    webhook_url = f"{settings.BACKEND_URL}/api/v1/github/webhook"
    hook_id = github_api_service.create_webhook(
        token.access_token, owner, repo_name, webhook_url, settings.GITHUB_WEBHOOK_SECRET or "flowdesk-dev"
    )

    repo = GithubRepository(
        installation_id=inst.id,
        workspace_id=project.workspace_id,
        project_id=body.project_id,
        repo_id=gh_repo["id"],
        repo_full_name=body.repo_full_name,
        default_branch=gh_repo.get("default_branch", "main"),
        connected_by=perms.user.id,
        webhook_hook_id=hook_id,
    )
    db.add(repo)
    audit(db, "github.repository_connected", organization_id=org_id, actor_id=perms.user.id,
          data={"repo": body.repo_full_name})
    db.commit()
    return RepositoryOut.model_validate(repo)


# ---------------------------------------------------------------------------
# Legacy manual endpoints (kept for backward compat)
# ---------------------------------------------------------------------------

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
        perms.require_project_view(repo.project_id)
    elif repo.workspace_id:
        perms.require_workspace_admin(repo.workspace_id)

    # Remove the webhook from GitHub if we created it
    if repo.webhook_hook_id:
        installation = db.get(GithubInstallation, repo.installation_id)
        org_id = installation.organization_id if installation else None
        if org_id:
            token_row = db.scalar(select(GithubOAuthToken).where(GithubOAuthToken.organization_id == org_id))
            if token_row:
                owner, repo_name = repo.repo_full_name.split("/", 1)
                github_api_service.delete_webhook(token_row.access_token, owner, repo_name, repo.webhook_hook_id)

    repo.is_active = False
    installation = db.get(GithubInstallation, repo.installation_id)
    audit(db, "github.repository_disconnected",
          organization_id=installation.organization_id if installation else None,
          actor_id=perms.user.id, data={"repo": repo.repo_full_name})
    db.commit()
    return Message(detail="Repository disconnected")


# ---------------------------------------------------------------------------
# Create GitHub issue from a task
# ---------------------------------------------------------------------------

@router.post("/tasks/{task_id}/create-issue", status_code=201)
def create_github_issue(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.models.project import Project
    from app.models.task import Task

    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_project_view(task.project_id)

    if task.github_issue_number:
        return {"issue_number": task.github_issue_number, "issue_url": task.github_issue_url}

    # Find a connected repo for this project
    repo = db.scalar(
        select(GithubRepository).where(
            GithubRepository.project_id == task.project_id,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    )
    if not repo:
        raise HTTPException(status_code=400, detail="No GitHub repository connected to this project")

    # Get the org OAuth token
    installation = db.get(GithubInstallation, repo.installation_id)
    if not installation:
        raise HTTPException(status_code=400, detail="GitHub installation not found")
    token_row = db.scalar(
        select(GithubOAuthToken).where(GithubOAuthToken.organization_id == installation.organization_id)
    )
    if not token_row:
        raise HTTPException(status_code=400, detail="GitHub is not connected for this organisation")

    project = db.get(Project, task.project_id)
    task_ref = f"{project.key}-{task.number}" if project else str(task_id)
    frontend_url = settings.FRONTEND_URL
    issue_body = (
        f"Linked to FlowDesk task **{task_ref}**: {task.title}\n\n"
        f"{task.description or ''}\n\n"
        f"[View in FlowDesk]({frontend_url}/app/tasks/{task.id})"
    ).strip()

    try:
        owner, repo_name = repo.repo_full_name.split("/", 1)
        gh_issue = github_api_service.create_issue(
            token_row.access_token, owner, repo_name,
            title=f"{task_ref}: {task.title}",
            body=issue_body,
        )
    except Exception:
        raise HTTPException(status_code=502, detail="Could not create issue on GitHub")

    task.github_issue_number = gh_issue["number"]
    task.github_issue_url = gh_issue["html_url"]
    db.commit()

    return {"issue_number": task.github_issue_number, "issue_url": task.github_issue_url}


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@router.get("/tasks/{task_id}/events", response_model=list[GithubEventOut])
def task_github_events(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.models.task import Task

    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_project_view(task.project_id)
    rows = db.scalars(
        select(GithubEvent)
        .where(GithubEvent.task_id == task_id)
        .order_by(GithubEvent.created_at.desc())
        .limit(20)
    ).all()
    return [GithubEventOut.model_validate(e) for e in rows]


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
