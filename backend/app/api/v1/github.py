"""GitHub integration.

Two connection types:

- **personal** (per org + user) — acts AS the member: create issues / branches /
  PRs from a task. Private to that user.
- **project** (per project, created by a project lead/admin) — shared by everyone
  on that project: incoming webhook activity sync, task status automation, repo
  linking and connected search. Independent per project, so the same person
  leading two projects connects each separately.
"""
import json
import re
import secrets
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import TypeVar

import jwt
import requests as http_requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.task_ref import format_task_ref
from app.db.session import get_db
from app.models.github import (
    CONNECTION_PERSONAL,
    CONNECTION_PROJECT,
    GithubConnection,
    GithubEvent,
    GithubInstallation,
    GithubRepository,
)
from app.schemas.common import Message, Page
from app.schemas.github import (
    AuthUrlOut,
    AvailableRepo,
    BranchCreateBody,
    BranchNameOut,
    BranchOut,
    CodeSearchItem,
    CodeSearchOut,
    ConnectionSettings,
    ConnectionStatusOut,
    GithubEventOut,
    InstallationCreate,
    InstallationOut,
    IssueCommentBody,
    IssueCreateBody,
    IssueOut,
    PersonalRepoLinkBody,
    PersonalRepoLinkOut,
    PullRequestActionBody,
    PullRequestCreateBody,
    PullRequestOut,
    RepoConnectBody,
    RepositoryConnect,
    RepositoryOut,
    SyncIssuesOut,
    IssueStatusSyncOut,
    SubIssuesSyncOut,
    IssueCommentsSyncOut,
    TaskPullRequestOut,
)
from app.schemas.comment import CommentOut
from app.services import github_api_service, github_service
from app.services.audit_service import audit
from app.services.github_issue_title import format_github_issue_title
from app.services.github_issue_body import format_github_issue_body
from app.services.permission_service import PermissionService
from app.services.token_vault import reveal, seal
from app.services.user_service import user_brief

router = APIRouter(prefix="/github", tags=["github"])


def _peek_github_token(conn: GithubConnection) -> str | None:
    """Return the decrypted OAuth token, or None when missing or unreadable."""
    token = reveal(conn.access_token)
    if not token or not token.strip():
        return None
    return token


def _github_token(conn: GithubConnection) -> str:
    token = _peek_github_token(conn)
    if not token:
        raise HTTPException(status_code=401, detail="GitHub connection is invalid — reconnect your account")
    return token


def _connection_token_valid(conn: GithubConnection) -> bool:
    token = _peek_github_token(conn)
    return bool(token and github_api_service.verify_token(token))


def _acting_connections_for_repo(
    db: Session,
    *,
    personal: GithubConnection | None,
    repo: GithubRepository,
) -> list[GithubConnection]:
    """Connections to try for a project-linked repo (personal, link, then project)."""
    connections: list[GithubConnection] = []
    seen: set[uuid.UUID] = set()

    def add(conn: GithubConnection | None) -> None:
        if conn and conn.id not in seen:
            connections.append(conn)
            seen.add(conn.id)

    add(personal)
    if repo.connection_id:
        add(db.get(GithubConnection, repo.connection_id))
    if repo.project_id:
        add(_project_connection(db, repo.project_id))
    return connections


def _acting_connection_for_repo(
    db: Session,
    *,
    personal: GithubConnection | None,
    repo: GithubRepository,
) -> GithubConnection:
    connections = _acting_connections_for_repo(db, personal=personal, repo=repo)
    if not connections:
        raise HTTPException(
            status_code=412,
            detail="Connect your personal GitHub account, or connect this project's GitHub, first",
        )
    return connections[0]


def _raise_github_api_error(exc: github_api_service.GitHubApiError) -> None:
    detail = exc.detail
    if exc.http_status == 401:
        detail = (
            "GitHub token is invalid or expired — disconnect and reconnect GitHub "
            "in the App Center (project connection and your personal account if linked)."
        )
    raise HTTPException(status_code=exc.http_status, detail=detail)


def _parsed_repo(repo_full_name: str) -> tuple[str, str]:
    try:
        return github_api_service.parse_repo_full_name(repo_full_name)
    except github_api_service.GitHubPathValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _personal_connection(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> GithubConnection | None:
    return db.scalar(
        select(GithubConnection).where(
            GithubConnection.organization_id == org_id,
            GithubConnection.user_id == user_id,
            GithubConnection.connection_type == CONNECTION_PERSONAL,
        )
    )


def _project_connection(db: Session, project_id: uuid.UUID) -> GithubConnection | None:
    return db.scalar(
        select(GithubConnection).where(
            GithubConnection.project_id == project_id,
            GithubConnection.connection_type == CONNECTION_PROJECT,
        )
    )


def _active_project_repo(db: Session, project_id: uuid.UUID) -> GithubRepository | None:
    """Return the single active repo linked to a project, if any."""
    return db.scalar(
        select(GithubRepository).where(
            GithubRepository.project_id == project_id,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    )


def _require_project_repo_slot(db: Session, project_id: uuid.UUID) -> None:
    if _active_project_repo(db, project_id):
        raise HTTPException(
            status_code=409,
            detail="This project already has a linked repository. Unlink it before connecting another.",
        )


def _repos_linked_to_other_projects(
    db: Session, *, exclude_project_id: uuid.UUID | None = None
) -> set[str]:
    """Repo full names already linked to a different project."""
    query = select(GithubRepository.repo_full_name).where(
        GithubRepository.project_id.isnot(None),
        GithubRepository.is_active.is_(True),
        GithubRepository.deleted_at.is_(None),
    )
    if exclude_project_id is not None:
        query = query.where(GithubRepository.project_id != exclude_project_id)
    return set(db.scalars(query).all())


def _require_repo_not_linked_elsewhere(
    db: Session, repo_full_name: str, project_id: uuid.UUID
) -> None:
    """One GitHub repo may only be linked to one FlowDesk project at a time."""
    taken = db.scalar(
        select(GithubRepository).where(
            GithubRepository.repo_full_name == repo_full_name,
            GithubRepository.project_id != project_id,
            GithubRepository.project_id.isnot(None),
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    )
    if taken:
        from app.models.project import Project

        other = db.get(Project, taken.project_id) if taken.project_id else None
        other_name = other.name if other else "another project"
        raise HTTPException(
            status_code=409,
            detail=(
                f"Repository {repo_full_name} is already linked to {other_name}. "
                "Unlink it from that project before linking it here."
            ),
        )


def _repo_linker_id(db: Session, repo: GithubRepository) -> uuid.UUID | None:
    """User who linked this repo — falls back to the project connection owner."""
    if repo.connected_by is not None:
        return repo.connected_by
    if repo.connection_id:
        conn = db.get(GithubConnection, repo.connection_id)
        if conn:
            return conn.connected_by
    return None


def _require_repo_unlink_perms(repo: GithubRepository, perms: PermissionService, db: Session) -> None:
    """Only the user who linked a project repository may unlink it."""
    if repo.project_id:
        linker = _repo_linker_id(db, repo)
        if linker is None or linker != perms.user.id:
            raise HTTPException(
                status_code=403,
                detail="Only the user who linked this repository can unlink it",
            )
        return
    if repo.connected_by is not None:
        if repo.connected_by != perms.user.id:
            raise HTTPException(
                status_code=403,
                detail="Only the user who linked this repository can unlink it",
            )
        return
    if repo.workspace_id:
        perms.require_workspace_admin(repo.workspace_id)
    else:
        raise HTTPException(status_code=403, detail="Not allowed to unlink this repository")


def _project_org_id(perms: PermissionService, project) -> uuid.UUID:
    return perms.get_workspace_or_404(project.workspace_id).organization_id


def _is_project_admin(perms: PermissionService, project_id: uuid.UUID) -> bool:
    """Whether the caller can manage GitHub + project settings (includes org/ws/space admin bypass)."""
    try:
        perms.require_project_admin(project_id)
        return True
    except HTTPException:
        return False


def _require_github_project_admin(perms: PermissionService, project_id: uuid.UUID):
    return perms.require_project_admin(project_id)


def _can_manage_project(perms: PermissionService, project) -> bool:
    return _is_project_admin(perms, project.id)


def _can_disconnect_project_connection(conn: GithubConnection, perms: PermissionService) -> bool:
    """Only the user who connected the project's GitHub account may disconnect it."""
    return conn.connected_by is not None and conn.connected_by == perms.user.id


def _is_project_connection_owner(conn: GithubConnection, perms: PermissionService) -> bool:
    return _can_disconnect_project_connection(conn, perms)


def _require_project_connection_owner(conn: GithubConnection, perms: PermissionService) -> None:
    if not _is_project_connection_owner(conn, perms):
        raise HTTPException(
            status_code=403,
            detail="Only the user who connected this GitHub account can manage its repository link",
        )


def _slugify(value: str, max_len: int = 50) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return slug[:max_len].strip("-")


def _format_branch_name(fmt: str, task_ref: str, task_title: str, username: str) -> str:
    name = (
        (fmt or ":taskId:-:taskName:")
        .replace(":taskId:", _slugify(task_ref))
        .replace(":taskName:", _slugify(task_title))
        .replace(":username:", _slugify(username))
    )
    # collapse empty segments left by missing tokens
    return re.sub(r"-{2,}", "-", name).strip("-") or _slugify(task_ref)


def _task_ref(db: Session, task) -> str:
    from app.models.project import Project
    project = db.get(Project, task.project_id)
    return format_task_ref(project.id, task.number) if project else str(task.id)


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
    if x_github_event not in ("push", "pull_request", "issues", "sub_issues", "ping"):
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
# OAuth flow (shared by personal + project connections)
# ---------------------------------------------------------------------------

_SAFE_RETURN_PATH = re.compile(r"^[a-z0-9][a-z0-9_\-/?=&.%]*$", re.I)

# CSRF protection for the OAuth round-trip: /authorize mints a random nonce,
# embeds it in the signed (short-lived) state AND drops it in an HttpOnly cookie.
# /callback only proceeds when the cookie matches the state — so a flow can only
# be completed by the same browser that started it (blocks forced account-linking).
_OAUTH_STATE_COOKIE = "flowdesk_gh_oauth"
_OAUTH_STATE_PATH = "/api/v1/github"
_OAUTH_STATE_TTL_MINUTES = 10


def _oauth_cookie_cross_site() -> bool:
    """Mirror the refresh cookie: SameSite=None;Secure when the frontend is on a
    different site (https deployment) so it survives the cross-site round-trip."""
    return settings.ENVIRONMENT == "production" or settings.FRONTEND_URL.startswith("https://")


def _set_oauth_state_cookie(response: Response, nonce: str) -> None:
    cross_site = _oauth_cookie_cross_site()
    response.set_cookie(
        _OAUTH_STATE_COOKIE,
        nonce,
        max_age=_OAUTH_STATE_TTL_MINUTES * 60,
        httponly=True,
        secure=cross_site,
        samesite="none" if cross_site else "lax",
        path=_OAUTH_STATE_PATH,
    )


def _sanitize_return_path(next_target: str | None) -> str:
    """Build a safe in-app path (/app/...) for post-OAuth redirect."""
    default = "/app/apps"
    raw = (next_target or "").strip()
    if not raw:
        return default
    if raw in ("apps", "planner", "dashboard"):
        return f"/app/{raw}"
    if raw.startswith("/app/"):
        base = raw.split("?")[0]
        if "//" in base or ".." in base:
            return default
        return raw
    if ".." not in raw and _SAFE_RETURN_PATH.match(raw):
        return f"/app/{raw}"
    return default


@router.get("/oauth/authorize", response_model=AuthUrlOut)
def github_oauth_authorize(
    response: Response,
    type: str = Query(pattern="^(personal|project)$"),
    org_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    next: str = "apps",
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Return the GitHub authorization URL. The browser is redirected there;
    GitHub then calls /oauth/callback. ``type`` selects which connection is made.
    """
    if type == CONNECTION_PROJECT:
        if not project_id:
            raise HTTPException(status_code=422, detail="project_id is required for a project connection")
        project = _require_github_project_admin(perms, project_id)
        existing = _project_connection(db, project_id)
        if existing and existing.connected_by != perms.user.id:
            raise HTTPException(
                status_code=409,
                detail="This project already has a GitHub connection. The user who connected it must disconnect first.",
            )
        org_id = _project_org_id(perms, project)
        scopes = "repo,admin:repo_hook"
    else:  # personal
        if not org_id:
            raise HTTPException(status_code=422, detail="org_id is required for a personal connection")
        perms.require_org_member(org_id)
        scopes = "repo"

    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured (GITHUB_CLIENT_ID missing)")

    now = datetime.now(timezone.utc)
    nonce = secrets.token_urlsafe(24)
    state = jwt.encode(
        {
            "type": type,
            "org_id": str(org_id),
            "project_id": str(project_id) if project_id else None,
            "user_id": str(perms.user.id),
            "next": next,
            "nonce": nonce,
            "iat": now,
            "exp": now + timedelta(minutes=_OAUTH_STATE_TTL_MINUTES),
        },
        settings.SECRET_KEY,
        algorithm="HS256",
    )
    _set_oauth_state_cookie(response, nonce)
    params = f"client_id={settings.GITHUB_CLIENT_ID}&scope={scopes}&state={state}"
    return AuthUrlOut(url=f"https://github.com/login/oauth/authorize?{params}")


@router.get("/oauth/callback", include_in_schema=False)
@limiter.limit("20/minute")
def github_oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    """GitHub redirects here after the user authorises. Stores the connection
    (personal or project) and sends the browser back to the frontend."""
    frontend = settings.FRONTEND_URL.rstrip("/")
    cookie_nonce = request.cookies.get(_OAUTH_STATE_COOKIE)

    def fail(return_path: str = "/app/apps"):
        resp = RedirectResponse(f"{frontend}{_sanitize_return_path(return_path)}?github_error=1")
        resp.delete_cookie(_OAUTH_STATE_COOKIE, path=_OAUTH_STATE_PATH)
        return resp

    if error or not code or not state:
        return fail()
    try:
        # jwt.decode enforces the `exp` claim, so an expired state is rejected here.
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=["HS256"])
        conn_type = payload["type"]
        org_id = uuid.UUID(payload["org_id"])
        user_id = uuid.UUID(payload["user_id"])
        project_id = uuid.UUID(payload["project_id"]) if payload.get("project_id") else None
        next_target = payload.get("next", "apps")
        state_nonce = payload.get("nonce")
    except Exception:
        return fail()

    # Bind the callback to the browser that started the flow: the state's nonce
    # must match the HttpOnly cookie. Blocks login-CSRF / forced account-linking.
    if not state_nonce or not cookie_nonce or not secrets.compare_digest(str(state_nonce), cookie_nonce):
        return fail(next_target)

    return_path = _sanitize_return_path(next_target)

    # Exchange code for a token
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
        return fail(next_target)

    access_token = data.get("access_token")
    if not access_token:
        return fail(next_target)
    try:
        gh_user = github_api_service.get_authenticated_user(access_token)
    except Exception:
        return fail(next_target)

    if conn_type == CONNECTION_PROJECT:
        if not project_id:
            return fail(next_target)
        existing = _project_connection(db, project_id)
        if existing and existing.connected_by != user_id:
            return fail(next_target)
    else:
        existing = _personal_connection(db, org_id, user_id)

    if existing:
        existing.access_token = seal(access_token) or ""
        existing.scope = data.get("scope", "")
        existing.github_user_login = gh_user["login"]
        existing.github_user_id = gh_user["id"]
        existing.connected_by = user_id
    else:
        db.add(GithubConnection(
            organization_id=org_id,
            connection_type=conn_type,
            user_id=user_id if conn_type == CONNECTION_PERSONAL else None,
            project_id=project_id if conn_type == CONNECTION_PROJECT else None,
            access_token=seal(access_token) or "",
            scope=data.get("scope", ""),
            github_user_login=gh_user["login"],
            github_user_id=gh_user["id"],
            connected_by=user_id,
        ))

    audit(db, "github.connected", organization_id=org_id, actor_id=user_id,
          data={"github_login": gh_user["login"], "type": conn_type})
    db.commit()
    success = RedirectResponse(
        f"{frontend}{return_path}?github_connected=1&gh_tab={conn_type}"
    )
    success.delete_cookie(_OAUTH_STATE_COOKIE, path=_OAUTH_STATE_PATH)
    return success


# ---------------------------------------------------------------------------
# Personal connection
# ---------------------------------------------------------------------------

@router.get("/organizations/{org_id}/personal-connection", response_model=ConnectionStatusOut)
def personal_connection_status(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_member(org_id)
    conn = _personal_connection(db, org_id, perms.user.id)
    if not conn:
        return ConnectionStatusOut(connected=False, connection_type=CONNECTION_PERSONAL, can_manage=True)
    valid = _connection_token_valid(conn)
    return ConnectionStatusOut(
        connected=valid,
        needs_reconnect=not valid,
        connection_type=CONNECTION_PERSONAL,
        github_user_login=conn.github_user_login if valid else None,
        can_manage=True,
        can_connect=not valid,
    )


@router.get("/organizations/{org_id}/personal-connection/repos", response_model=list[AvailableRepo])
def list_personal_repos(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Repositories the caller's own GitHub account can access.

    Used to browse your repos in the App Center and to pick a repo for a task's
    branch / issue / PR actions — independent of any project connection.
    """
    perms.require_org_member(org_id)
    conn = _personal_connection(db, org_id, perms.user.id)
    if not conn:
        raise HTTPException(
            status_code=412,
            detail="Connect your personal GitHub account first",
        )
    try:
        raw = github_api_service.list_accessible_repos(_github_token(conn))
    except github_api_service.GitHubApiError as exc:
        _raise_github_api_error(exc)
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


@router.get("/organizations/{org_id}/personal-connection/links", response_model=list[PersonalRepoLinkOut])
def list_personal_repo_links(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Repos the caller has linked to a project via their personal connection."""
    perms.require_org_member(org_id)
    conn = _personal_connection(db, org_id, perms.user.id)
    if not conn:
        return []
    from app.models.project import Project
    rows = db.execute(
        select(GithubRepository, Project.name)
        .join(Project, Project.id == GithubRepository.project_id)
        .where(
            GithubRepository.connection_id == conn.id,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    ).all()
    return [
        PersonalRepoLinkOut(
            id=repo.id,
            repo_full_name=repo.repo_full_name,
            project_id=repo.project_id,
            project_name=project_name,
            connected_by=repo.connected_by,
        )
        for repo, project_name in rows
    ]


@router.post(
    "/organizations/{org_id}/personal-connection/connect-repo",
    response_model=RepositoryOut,
    status_code=201,
)
def connect_personal_repo(
    org_id: uuid.UUID,
    body: PersonalRepoLinkBody,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Link one of the caller's own repos to a project, operated by their personal token.

    Creates the activity webhook with the caller's token so the repo's pushes / PRs /
    issues sync into that project's tasks — no separate project connection required.
    """
    perms.require_org_member(org_id)
    conn = _personal_connection(db, org_id, perms.user.id)
    if not conn:
        raise HTTPException(status_code=412, detail="Connect your personal GitHub account first")
    project = perms.require_project_admin(body.project_id)
    ws = perms.get_workspace_or_404(project.workspace_id)
    if ws.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Project does not belong to this organization")

    if _project_connection(db, body.project_id):
        raise HTTPException(
            status_code=409,
            detail="This project already has a shared GitHub connection. Link a repository from the Project tab.",
        )

    _require_project_repo_slot(db, body.project_id)
    _require_repo_not_linked_elsewhere(db, body.repo_full_name, body.project_id)

    try:
        owner, repo_name = _parsed_repo(body.repo_full_name)
        gh_repo = github_api_service.get_repo(_github_token(conn), owner, repo_name)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=404,
            detail="Repository not found or not accessible with your GitHub account",
        )

    hook_id = _register_repo_webhook(_github_token(conn), owner, repo_name)

    repo = GithubRepository(
        connection_id=conn.id,
        workspace_id=project.workspace_id,
        project_id=body.project_id,
        repo_id=gh_repo["id"],
        repo_full_name=body.repo_full_name,
        default_branch=gh_repo.get("default_branch", "main"),
        connected_by=perms.user.id,
        webhook_hook_id=hook_id,
    )
    db.add(repo)
    db.flush()
    imported = github_service.backfill_open_issues(db, repo)
    audit(db, "github.repository_connected", organization_id=org_id, actor_id=perms.user.id,
          data={"repo": body.repo_full_name, "project_id": str(body.project_id),
                "via": "personal", "imported_issues": imported})
    db.commit()
    return RepositoryOut.model_validate(repo)


def _revoke_on_github(db: Session, conn: GithubConnection) -> None:
    """Fully revoke the connection's GitHub authorization (grant) on disconnect.

    Deleting the grant clears GitHub's stored consent, so the next connect re-shows
    the authorization screen (where the user can request organization-repo access)
    instead of silently reconnecting. Best-effort — never blocks the disconnect."""
    if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_CLIENT_SECRET:
        return
    token = reveal(conn.access_token)
    if not token:
        return
    github_api_service.revoke_authorization(
        settings.GITHUB_CLIENT_ID, settings.GITHUB_CLIENT_SECRET, token
    )


@router.delete("/organizations/{org_id}/personal-connection", response_model=Message)
def disconnect_personal(
    org_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_member(org_id)
    conn = _personal_connection(db, org_id, perms.user.id)
    if conn:
        _revoke_on_github(db, conn)
        db.delete(conn)
    audit(db, "github.disconnected", organization_id=org_id, actor_id=perms.user.id,
          data={"type": CONNECTION_PERSONAL})
    db.commit()
    return Message(detail="GitHub personal connection removed")


# ---------------------------------------------------------------------------
# Project connection (shared by the project's members)
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/connection", response_model=ConnectionStatusOut)
def project_connection_status(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_view(project_id)
    can_manage = _can_manage_project(perms, project)
    conn = _project_connection(db, project_id)
    if not conn:
        return ConnectionStatusOut(
            connected=False,
            connection_type=CONNECTION_PROJECT,
            can_manage=can_manage,
            can_connect=can_manage,
        )
    can_disconnect = _can_disconnect_project_connection(conn, perms)
    valid = _connection_token_valid(conn)
    can_link_repo = can_manage and can_disconnect and valid and _active_project_repo(db, project_id) is None
    return ConnectionStatusOut(
        connected=valid,
        needs_reconnect=not valid,
        connection_type=CONNECTION_PROJECT,
        github_user_login=conn.github_user_login if valid else conn.github_user_login,
        can_manage=can_manage,
        can_connect=can_disconnect and not valid,
        can_disconnect=can_disconnect,
        can_link_repo=can_link_repo,
        connected_by=conn.connected_by,
        branch_name_format=conn.branch_name_format,
        connected_search_enabled=conn.connected_search_enabled,
    )


@router.delete("/projects/{project_id}/connection", response_model=Message)
def disconnect_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_view(project_id)
    conn = _project_connection(db, project_id)
    if conn:
        if not _can_disconnect_project_connection(conn, perms):
            raise HTTPException(
                status_code=403,
                detail="Only the user who connected this GitHub account can disconnect it",
            )
        if _active_project_repo(db, project_id):
            raise HTTPException(
                status_code=409,
                detail="Unlink the repository before disconnecting the GitHub account",
            )
        _revoke_on_github(db, conn)
        db.delete(conn)
    audit(db, "github.disconnected", organization_id=_project_org_id(perms, project), actor_id=perms.user.id,
          data={"type": CONNECTION_PROJECT, "project_id": str(project_id)})
    db.commit()
    return Message(detail="GitHub project connection removed")


@router.patch("/projects/{project_id}/connection/settings", response_model=ConnectionStatusOut)
def update_project_connection_settings(
    project_id: uuid.UUID,
    body: ConnectionSettings,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = _require_github_project_admin(perms, project_id)
    conn = _project_connection(db, project_id)
    if not conn:
        raise HTTPException(status_code=400, detail="Connect a project GitHub account first")
    _require_project_connection_owner(conn, perms)
    if body.branch_name_format is not None:
        conn.branch_name_format = body.branch_name_format.strip() or ":taskId:-:taskName:"
    if body.connected_search_enabled is not None:
        conn.connected_search_enabled = body.connected_search_enabled
    db.commit()
    can_manage = _can_manage_project(perms, project)
    can_disconnect = _can_disconnect_project_connection(conn, perms)
    return ConnectionStatusOut(
        connected=True, connection_type=CONNECTION_PROJECT,
        github_user_login=conn.github_user_login, can_manage=can_manage,
        can_connect=False,
        can_disconnect=can_disconnect,
        can_link_repo=can_manage and can_disconnect and _active_project_repo(db, project_id) is None,
        connected_by=conn.connected_by,
        branch_name_format=conn.branch_name_format,
        connected_search_enabled=conn.connected_search_enabled,
    )


@router.get("/projects/{project_id}/available-repos", response_model=list[AvailableRepo])
def list_available_repos(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Repos the project connection can access — for linking to this project."""
    _require_github_project_admin(perms, project_id)
    conn = _project_connection(db, project_id)
    if not conn:
        raise HTTPException(status_code=400, detail="Connect a project GitHub account first")
    _require_project_connection_owner(conn, perms)
    if _active_project_repo(db, project_id):
        raise HTTPException(
            status_code=409,
            detail="This project already has a linked repository. Unlink it before connecting another.",
        )
    try:
        raw = github_api_service.list_accessible_repos(_github_token(conn))
    except github_api_service.GitHubApiError as exc:
        _raise_github_api_error(exc)
    except Exception:
        raise HTTPException(status_code=502, detail="Could not fetch repositories from GitHub")
    taken = _repos_linked_to_other_projects(db, exclude_project_id=project_id)
    return [
        AvailableRepo(
            repo_id=r["id"],
            repo_full_name=r["full_name"],
            default_branch=r.get("default_branch", "main"),
            private=r.get("private", False),
        )
        for r in raw
        if r["full_name"] not in taken
    ]


@router.get("/projects/{project_id}/search", response_model=CodeSearchOut)
def connected_search(
    project_id: uuid.UUID,
    q: str = Query(min_length=1, max_length=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Connected search: search code across the project connection's repos."""
    perms.require_project_view(project_id)
    conn = _project_connection(db, project_id)
    if not conn or not conn.connected_search_enabled:
        return CodeSearchOut(connected=False)
    try:
        items = github_api_service.search_code(_github_token(conn), q)
    except Exception:
        return CodeSearchOut(connected=True, items=[])
    return CodeSearchOut(
        connected=True,
        items=[
            CodeSearchItem(
                name=it.get("name", ""),
                path=it.get("path", ""),
                repo_full_name=(it.get("repository") or {}).get("full_name", ""),
                url=it.get("html_url", ""),
            )
            for it in items
        ],
    )


# ---------------------------------------------------------------------------
# Repository linking (uses the project connection)
# ---------------------------------------------------------------------------

def _register_repo_webhook(token: str, owner: str, repo_name: str) -> int | None:
    """Create the FlowDesk activity webhook on a repo. Returns the GitHub hook id."""
    webhook_secret = settings.GITHUB_WEBHOOK_SECRET.strip()
    if not webhook_secret:
        if settings.is_production:
            raise HTTPException(status_code=503, detail="GitHub webhook secret is not configured")
        webhook_secret = "flowdesk-dev"
    webhook_url = f"{settings.BACKEND_URL}/api/v1/github/webhook"
    return github_api_service.create_webhook(token, owner, repo_name, webhook_url, webhook_secret)


def _ensure_personal_repo_linked(
    db: Session,
    *,
    personal: GithubConnection,
    project,
    repo_full_name: str,
    user_id: uuid.UUID,
    gh_repo: dict,
) -> GithubRepository:
    """Register a personal repo on the project so inbound GitHub issues sync."""
    existing = db.scalar(
        select(GithubRepository).where(
            GithubRepository.project_id == project.id,
            GithubRepository.repo_full_name == repo_full_name,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    )
    if existing:
        return existing

    owner, repo_name = _parsed_repo(repo_full_name)
    token = _github_token(personal)
    hook_id = _register_repo_webhook(token, owner, repo_name)
    repo = GithubRepository(
        connection_id=personal.id,
        workspace_id=project.workspace_id,
        project_id=project.id,
        repo_id=gh_repo["id"],
        repo_full_name=repo_full_name,
        default_branch=gh_repo.get("default_branch", "main"),
        connected_by=user_id,
        webhook_hook_id=hook_id,
    )
    db.add(repo)
    db.flush()
    github_service.backfill_open_issues(db, repo)
    return repo


@router.post("/projects/{project_id}/connect-repo", response_model=RepositoryOut, status_code=201)
def connect_repo(
    project_id: uuid.UUID,
    body: RepoConnectBody,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Link a repo to a project using the project connection. Auto-creates the webhook."""
    project = _require_github_project_admin(perms, project_id)
    conn = _project_connection(db, project_id)
    if not conn:
        raise HTTPException(
            status_code=400,
            detail="This project has no GitHub connection. Ask a project admin to connect one in the App Center.",
        )
    _require_project_connection_owner(conn, perms)
    _require_project_repo_slot(db, project_id)
    _require_repo_not_linked_elsewhere(db, body.repo_full_name, project_id)
    try:
        owner, repo_name = _parsed_repo(body.repo_full_name)
        gh_repo = github_api_service.get_repo(_github_token(conn), owner, repo_name)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Could not fetch repository details from GitHub")

    hook_id = _register_repo_webhook(_github_token(conn), owner, repo_name)

    repo = GithubRepository(
        connection_id=conn.id,
        workspace_id=project.workspace_id,
        project_id=project_id,
        repo_id=gh_repo["id"],
        repo_full_name=body.repo_full_name,
        default_branch=gh_repo.get("default_branch", "main"),
        connected_by=perms.user.id,
        webhook_hook_id=hook_id,
    )
    db.add(repo)
    db.flush()
    imported = github_service.backfill_open_issues(db, repo)
    audit(db, "github.repository_connected", organization_id=_project_org_id(perms, project),
          actor_id=perms.user.id,
          data={"repo": body.repo_full_name, "project_id": str(project_id), "imported_issues": imported})
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
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    ).all()
    return [RepositoryOut.model_validate(r) for r in rows]


@router.post("/projects/{project_id}/sync-issues", response_model=SyncIssuesOut)
def sync_project_github_issues(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Import open GitHub issues from linked repos and sync linked task statuses."""
    perms.require_project_view(project_id)
    imported, status_synced = github_service.sync_project_issues(db, project_id)
    db.commit()
    return SyncIssuesOut(imported=imported, status_synced=status_synced)


@router.delete("/repositories/{repo_id}", response_model=Message)
def disconnect_repository(
    repo_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    repo = db.get(GithubRepository, repo_id)
    if not repo or repo.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Repository not found")
    _require_repo_unlink_perms(repo, perms, db)

    # Remove the webhook from GitHub using the project connection that created it
    if repo.webhook_hook_id and repo.connection_id:
        conn = db.get(GithubConnection, repo.connection_id)
        if conn:
            owner, repo_name = _parsed_repo(repo.repo_full_name)
            github_api_service.delete_webhook(_github_token(conn), owner, repo_name, repo.webhook_hook_id)

    repo.is_active = False
    org_id = None
    if repo.workspace_id:
        from app.models.workspace import Workspace
        ws = db.get(Workspace, repo.workspace_id)
        org_id = ws.organization_id if ws else None
    audit(db, "github.repository_disconnected", organization_id=org_id, actor_id=perms.user.id,
          data={"repo": repo.repo_full_name})
    db.commit()
    return Message(detail="Repository disconnected")


# ---------------------------------------------------------------------------
# Task commands (personal connection — act AS the caller)
# ---------------------------------------------------------------------------

def _require_task(db: Session, perms: PermissionService, task_id: uuid.UUID):
    from app.models.task import Task
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_task_edit(task)
    return task


def _require_task_view(db: Session, perms: PermissionService, task_id: uuid.UUID):
    from app.models.task import Task
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_task_view(task)
    return task


def _active_repo_for_project(
    db: Session, project_id: uuid.UUID, repo_id: uuid.UUID | None = None
) -> GithubRepository | None:
    query = select(GithubRepository).where(
        GithubRepository.project_id == project_id,
        GithubRepository.is_active.is_(True),
        GithubRepository.deleted_at.is_(None),
    )
    if repo_id:
        query = query.where(GithubRepository.id == repo_id)
    return db.scalar(query)


def _task_org_id(db: Session, perms: PermissionService, task) -> uuid.UUID:
    """Organization that owns a task (via its project's workspace)."""
    from app.models.project import Project
    project = db.get(Project, task.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return perms.get_workspace_or_404(project.workspace_id).organization_id


def _resolve_task_target(
    db: Session,
    perms: PermissionService,
    task,
    *,
    repository_id: uuid.UUID | None = None,
    repo_full_name: str | None = None,
    ensure_project_link: bool = False,
) -> tuple[str, str, str, str, str]:
    """Resolve a task command's target repo and the GitHub token to act with.

    Returns ``(token, owner, repo, default_branch, username)``.

    - An explicit personal repo (``repo_full_name``) requires a personal connection
      and acts as the caller.
    - A project-linked repo acts as the caller's personal connection when they have
      one; otherwise it falls back to the **project connection** (the shared account
      that linked the repo) so a project member without a personal connection can
      still create issues / branches / PRs.
    """
    org_id = _task_org_id(db, perms, task)
    personal = _personal_connection(db, org_id, perms.user.id)

    if repo_full_name:
        if not personal:
            raise HTTPException(
                status_code=412,
                detail="Connect your personal GitHub account in the App Center first",
            )
        owner, repo_name = _parsed_repo(repo_full_name)
        try:
            gh_repo = github_api_service.get_repo(_github_token(personal), owner, repo_name)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=404,
                detail="Repository not found or not accessible with your GitHub account",
            )
        if ensure_project_link:
            from app.models.project import Project

            project = db.get(Project, task.project_id)
            if project:
                _ensure_personal_repo_linked(
                    db,
                    personal=personal,
                    project=project,
                    repo_full_name=repo_full_name,
                    user_id=perms.user.id,
                    gh_repo=gh_repo,
                )
        return (_github_token(personal), owner, repo_name,
                gh_repo.get("default_branch", "main"), personal.github_user_login)

    repo = _active_repo_for_project(db, task.project_id, repository_id)
    if not repo:
        raise HTTPException(
            status_code=400,
            detail="Select a repository, or link one to this project first.",
        )
    owner, repo_name = _parsed_repo(repo.repo_full_name)
    acting = _acting_connection_for_repo(db, personal=personal, repo=repo)
    return (_github_token(acting), owner, repo_name, repo.default_branch, acting.github_user_login)


def _create_github_issue_with_token_fallback(
    db: Session,
    *,
    personal: GithubConnection | None,
    repo: GithubRepository,
    owner: str,
    repo_name: str,
    issue_title: str,
    issue_body: str,
) -> tuple[dict, str]:
    """Create a GitHub issue, retrying with the project token if personal is revoked."""
    connections = _acting_connections_for_repo(db, personal=personal, repo=repo)
    if not connections:
        raise HTTPException(
            status_code=412,
            detail="Connect your personal GitHub account, or connect this project's GitHub, first",
        )
    last_error: github_api_service.GitHubApiError | None = None
    for index, acting in enumerate(connections):
        token = _peek_github_token(acting)
        if not token:
            continue
        try:
            return (
                github_api_service.create_issue(
                    token, owner, repo_name, title=issue_title, body=issue_body
                ),
                token,
            )
        except github_api_service.GitHubApiError as exc:
            last_error = exc
            if exc.http_status in (401, 403) and index < len(connections) - 1:
                continue
            _raise_github_api_error(exc)
        except Exception:
            raise HTTPException(status_code=502, detail="Could not create issue on GitHub")
    if last_error:
        _raise_github_api_error(last_error)
    raise HTTPException(
        status_code=401,
        detail=(
            "GitHub token is invalid or expired — disconnect and reconnect GitHub "
            "in the App Center (project connection and your personal account if linked)."
        ),
    )


_T = TypeVar("_T")


def _github_action_with_token_fallback(
    db: Session,
    *,
    personal: GithubConnection | None,
    repo: GithubRepository,
    action: Callable[[str], _T],
    failure_detail: str,
) -> _T:
    """Run a GitHub REST action, retrying with the project token if personal is revoked."""
    connections = _acting_connections_for_repo(db, personal=personal, repo=repo)
    if not connections:
        raise HTTPException(
            status_code=412,
            detail="Connect your personal GitHub account, or connect this project's GitHub, first",
        )
    last_error: github_api_service.GitHubApiError | None = None
    for index, acting in enumerate(connections):
        token = _peek_github_token(acting)
        if not token:
            continue
        try:
            return action(token)
        except github_api_service.GitHubApiError as exc:
            last_error = exc
            if exc.http_status in (401, 403) and index < len(connections) - 1:
                continue
            _raise_github_api_error(exc)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=failure_detail) from exc
    if last_error:
        _raise_github_api_error(last_error)
    raise HTTPException(
        status_code=401,
        detail=(
            "GitHub token is invalid or expired — disconnect and reconnect GitHub "
            "in the App Center (project connection and your personal account if linked)."
        ),
    )


@router.get("/tasks/{task_id}/branch-name", response_model=BranchNameOut)
def suggested_branch_name(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.models.project import Project
    task = _require_task_view(db, perms, task_id)
    project = db.get(Project, task.project_id)
    ws = perms.get_workspace_or_404(project.workspace_id)
    conn = _project_connection(db, task.project_id)
    fmt = conn.branch_name_format if conn else ":taskId:-:taskName:"
    personal = _personal_connection(db, ws.organization_id, perms.user.id)
    username = personal.github_user_login if personal else ""
    return BranchNameOut(branch_name=_format_branch_name(fmt, _task_ref(db, task), task.title, username))


@router.post("/tasks/{task_id}/create-issue", response_model=IssueOut, status_code=201)
def create_github_issue(
    task_id: uuid.UUID,
    body: IssueCreateBody | None = None,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = _require_task(db, perms, task_id)
    if task.github_issue_number:
        return IssueOut(issue_number=task.github_issue_number, issue_url=task.github_issue_url)

    body = body or IssueCreateBody()
    task_ref = _task_ref(db, task)
    from app.models.project import Project

    project = db.get(Project, task.project_id)
    issue_title = (
        format_github_issue_title(project.name, task.title)
        if project
        else task.title
    )
    issue_body = format_github_issue_body(
        task_ref=task_ref,
        title=task.title,
        description=task.description,
        task_id=task.id,
    )

    org_id = _task_org_id(db, perms, task)
    personal = _personal_connection(db, org_id, perms.user.id)
    repo = _active_repo_for_project(db, task.project_id, body.repository_id)
    if not repo and not body.repo_full_name:
        raise HTTPException(
            status_code=400,
            detail="Select a repository, or link one to this project first.",
        )
    token: str | None = None
    owner: str
    repo_name: str
    if body.repo_full_name:
        token, owner, repo_name, _, _ = _resolve_task_target(
            db,
            perms,
            task,
            repository_id=body.repository_id,
            repo_full_name=body.repo_full_name,
            ensure_project_link=True,
        )
        try:
            gh_issue = github_api_service.create_issue(
                token, owner, repo_name, title=issue_title, body=issue_body
            )
        except github_api_service.GitHubApiError as exc:
            _raise_github_api_error(exc)
        except Exception:
            raise HTTPException(status_code=502, detail="Could not create issue on GitHub")
    else:
        assert repo is not None
        owner, repo_name = _parsed_repo(repo.repo_full_name)
        gh_issue, token = _create_github_issue_with_token_fallback(
            db,
            personal=personal,
            repo=repo,
            owner=owner,
            repo_name=repo_name,
            issue_title=issue_title,
            issue_body=issue_body,
        )

    task.github_issue_number = gh_issue["number"]
    task.github_issue_url = gh_issue["html_url"]
    if task.parent_task_id and token:
        parent = db.get(Task, task.parent_task_id)
        if parent and parent.github_issue_number and gh_issue.get("id"):
            try:
                github_api_service.add_sub_issue(
                    token,
                    owner,
                    repo_name,
                    parent.github_issue_number,
                    gh_issue["id"],
                )
            except github_api_service.GitHubApiError:
                pass
            except Exception:
                pass
    db.commit()
    return IssueOut(issue_number=task.github_issue_number, issue_url=task.github_issue_url)


@router.post("/tasks/{task_id}/create-branch", response_model=BranchOut, status_code=201)
def create_task_branch(
    task_id: uuid.UUID,
    body: BranchCreateBody,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = _require_task(db, perms, task_id)
    org_id = _task_org_id(db, perms, task)
    personal = _personal_connection(db, org_id, perms.user.id)

    branch = (body.branch_name or "").strip()
    if not branch:
        proj_conn = _project_connection(db, task.project_id)
        fmt = proj_conn.branch_name_format if proj_conn else ":taskId:-:taskName:"
        username = personal.github_user_login if personal else ""
        branch = _format_branch_name(fmt, _task_ref(db, task), task.title, username)

    if body.repo_full_name:
        token, owner, repo_name, default_branch, _ = _resolve_task_target(
            db, perms, task, repository_id=body.repository_id, repo_full_name=body.repo_full_name
        )
        try:
            url = github_api_service.create_branch(token, owner, repo_name, branch, default_branch)
        except github_api_service.GitHubApiError as exc:
            _raise_github_api_error(exc)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Could not create branch on GitHub") from exc
        return BranchOut(branch=branch, url=url)

    repo = _active_repo_for_project(db, task.project_id, body.repository_id)
    if not repo:
        raise HTTPException(
            status_code=400,
            detail="Select a repository, or link one to this project first.",
        )
    owner, repo_name = _parsed_repo(repo.repo_full_name)
    base = repo.default_branch

    def run(token: str) -> str:
        return github_api_service.create_branch(token, owner, repo_name, branch, base)

    url = _github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=run,
        failure_detail="Could not create branch on GitHub",
    )
    return BranchOut(branch=branch, url=url)


@router.post("/tasks/{task_id}/create-pr", response_model=PullRequestOut, status_code=201)
def create_task_pr(
    task_id: uuid.UUID,
    body: PullRequestCreateBody,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = _require_task(db, perms, task_id)
    org_id = _task_org_id(db, perms, task)
    personal = _personal_connection(db, org_id, perms.user.id)

    task_ref = _task_ref(db, task)
    from app.models.project import Project

    project = db.get(Project, task.project_id)
    default_title = (
        format_github_issue_title(project.name, task.title)
        if project
        else f"{task_ref}: {task.title}"
    )
    title = (body.title or default_title).strip()
    pr_body = f"Linked to FlowDesk task **{task_ref}**\n\n{settings.FRONTEND_URL}/app/tasks/{task.id}"
    commit_message = f"FlowDesk: {task_ref} — {task.title}".strip()

    if body.repo_full_name:
        token, owner, repo_name, default_branch, _ = _resolve_task_target(
            db, perms, task, repository_id=body.repository_id, repo_full_name=body.repo_full_name
        )
        base = (body.base or default_branch).strip()
        head = body.head.strip()
        try:
            pr = github_api_service.open_pull_request_for_branch(
                token, owner, repo_name, title=title, head=head, base=base, body=pr_body,
                commit_message=commit_message,
            )
        except github_api_service.GitHubApiError as exc:
            _raise_github_api_error(exc)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Could not create pull request on GitHub") from exc
        return PullRequestOut(number=pr["number"], url=pr["html_url"])

    repo = _active_repo_for_project(db, task.project_id, body.repository_id)
    if not repo:
        raise HTTPException(
            status_code=400,
            detail="Select a repository, or link one to this project first.",
        )
    owner, repo_name = _parsed_repo(repo.repo_full_name)
    base = (body.base or repo.default_branch).strip()
    head = body.head.strip()

    def run(token: str) -> dict:
        return github_api_service.open_pull_request_for_branch(
            token, owner, repo_name, title=title, head=head, base=base, body=pr_body,
            commit_message=commit_message,
        )

    pr = _github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=run,
        failure_detail="Could not create pull request on GitHub",
    )
    return PullRequestOut(number=pr["number"], url=pr["html_url"])


def _task_pull_requests_from_github(
    db: Session,
    task,
    repo: GithubRepository,
    personal: GithubConnection | None,
) -> list[dict]:
    """Collect open PRs linked to a task (from stored events + title/body scan)."""
    from app.models.github import GithubEvent

    task_ref = _task_ref(db, task)
    owner, repo_name = _parsed_repo(repo.repo_full_name)
    seen: set[int] = set()
    candidates: list[int] = []

    event_rows = db.scalars(
        select(GithubEvent).where(
            GithubEvent.task_id == task.id,
            GithubEvent.event_type == "pull_request",
        )
    ).all()
    for row in event_rows:
        number = (row.payload or {}).get("number")
        if number is not None:
            candidates.append(int(number))

    def collect(token: str) -> list[dict]:
        out: list[dict] = []
        ref_lower = task_ref.lower()
        for pr in github_api_service.list_pull_requests(token, owner, repo_name, state="open"):
            number = int(pr["number"])
            if number in seen:
                continue
            title = (pr.get("title") or "").lower()
            body = (pr.get("body") or "").lower()
            if number in candidates or ref_lower in title or ref_lower in body:
                seen.add(number)
                out.append(pr)
        for number in candidates:
            if number in seen:
                continue
            try:
                pr = github_api_service.get_pull_request(token, owner, repo_name, number)
            except github_api_service.GitHubApiError:
                continue
            if pr.get("state") == "open" and not pr.get("merged"):
                seen.add(number)
                out.append(pr)
        return out

    return _github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=collect,
        failure_detail="Could not list pull requests from GitHub",
    )


@router.get("/tasks/{task_id}/pull-requests", response_model=list[TaskPullRequestOut])
def list_task_pull_requests(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.models.project import Project

    task = _require_task_view(db, perms, task_id)
    repo = _active_repo_for_project(db, task.project_id)
    if not repo:
        return []
    project = db.get(Project, task.project_id)
    if not project:
        return []
    org_id = perms.get_workspace_or_404(project.workspace_id).organization_id
    personal = _personal_connection(db, org_id, perms.user.id)
    try:
        prs = _task_pull_requests_from_github(db, task, repo, personal)
    except HTTPException:
        return []
    return [
        TaskPullRequestOut(
            number=int(pr["number"]),
            url=pr["html_url"],
            title=pr.get("title") or "",
            state=pr.get("state") or "open",
            merged=bool(pr.get("merged")),
        )
        for pr in prs
    ]


@router.post("/tasks/{task_id}/pull-requests/{pr_number}/merge", response_model=PullRequestOut)
def merge_task_pull_request(
    task_id: uuid.UUID,
    pr_number: int,
    body: PullRequestActionBody | None = None,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = _require_task(db, perms, task_id)
    body = body or PullRequestActionBody()
    org_id = _task_org_id(db, perms, task)
    personal = _personal_connection(db, org_id, perms.user.id)
    repo = _active_repo_for_project(db, task.project_id, body.repository_id)
    if not repo:
        raise HTTPException(status_code=400, detail="Link a repository to this project first.")
    owner, repo_name = _parsed_repo(repo.repo_full_name)

    def run(token: str) -> dict:
        merged = github_api_service.merge_pull_request(token, owner, repo_name, pr_number)
        return merged if merged.get("merged") else github_api_service.get_pull_request(
            token, owner, repo_name, pr_number
        )

    pr = _github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=run,
        failure_detail="Could not merge pull request on GitHub",
    )
    url = pr.get("html_url") or f"https://github.com/{owner}/{repo_name}/pull/{pr_number}"
    return PullRequestOut(number=pr_number, url=url)


@router.post("/tasks/{task_id}/pull-requests/{pr_number}/close", response_model=PullRequestOut)
def close_task_pull_request(
    task_id: uuid.UUID,
    pr_number: int,
    body: PullRequestActionBody | None = None,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = _require_task(db, perms, task_id)
    body = body or PullRequestActionBody()
    org_id = _task_org_id(db, perms, task)
    personal = _personal_connection(db, org_id, perms.user.id)
    repo = _active_repo_for_project(db, task.project_id, body.repository_id)
    if not repo:
        raise HTTPException(status_code=400, detail="Link a repository to this project first.")
    owner, repo_name = _parsed_repo(repo.repo_full_name)

    def run(token: str) -> dict:
        return github_api_service.close_pull_request(token, owner, repo_name, pr_number)

    pr = _github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=run,
        failure_detail="Could not close pull request on GitHub",
    )
    return PullRequestOut(number=pr_number, url=pr.get("html_url", ""))


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@router.post("/tasks/{task_id}/sync-issue-status", response_model=IssueStatusSyncOut)
def sync_task_github_issue_status(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Poll GitHub for the linked issue state and update this task's board status."""
    task = _require_task_view(db, perms, task_id)
    if not task.github_issue_number:
        return IssueStatusSyncOut(updated=False, status_id=str(task.status_id) if task.status_id else None)
    updated = github_service.sync_task_issue_status_from_github(db, task)
    if updated:
        db.commit()
    return IssueStatusSyncOut(
        updated=updated,
        status_id=str(task.status_id) if task.status_id else None,
    )


@router.post("/tasks/{task_id}/reopen-issue", response_model=IssueStatusSyncOut)
def reopen_task_github_issue(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Reopen the linked GitHub issue and move this task back to To Do."""
    task = _require_task(db, perms, task_id)
    if not task.github_issue_number:
        raise HTTPException(status_code=400, detail="This task has no linked GitHub issue")
    repo = _active_repo_for_project(db, task.project_id)
    if not repo:
        raise HTTPException(
            status_code=400,
            detail="Link a repository to this project in App Center first.",
        )
    reopen_status = github_service.reopen_status_for(db, task.project_id)
    if not reopen_status:
        raise HTTPException(
            status_code=400,
            detail="This project has no To Do status configured.",
        )
    org_id = _task_org_id(db, perms, task)
    personal = _personal_connection(db, org_id, perms.user.id)
    owner, repo_name = _parsed_repo(repo.repo_full_name)
    label_name = f"{github_api_service.FLOWDESK_LABEL_PREFIX}{reopen_status.name}"

    def run(token: str) -> bool:
        github_api_service.update_issue_state(
            token,
            owner,
            repo_name,
            int(task.github_issue_number),
            "open",
        )
        try:
            github_api_service.sync_issue_status(
                token,
                owner,
                repo_name,
                int(task.github_issue_number),
                state="open",
                label_name=label_name,
                label_color=reopen_status.color,
                mirror_state=False,
            )
        except Exception:
            pass
        return True

    _github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=run,
        failure_detail="Could not reopen issue on GitHub",
    )

    updated = github_service.reopen_task_github_issue_state(
        db, repo, task, actor=perms.user.email if perms.user else None
    )
    db.commit()
    return IssueStatusSyncOut(
        updated=updated,
        status_id=str(task.status_id) if task.status_id else None,
    )


@router.post("/tasks/{task_id}/sync-sub-issues", response_model=SubIssuesSyncOut)
def sync_task_github_sub_issues(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Import GitHub sub-issues as FlowDesk subtasks for a linked parent task."""
    task = _require_task_view(db, perms, task_id)
    if not task.github_issue_number or task.parent_task_id:
        return SubIssuesSyncOut(imported=0)
    repo = _active_repo_for_project(db, task.project_id)
    if not repo:
        return SubIssuesSyncOut(imported=0)
    imported = github_service.sync_sub_issues_for_parent_task(db, repo, task)
    if imported:
        db.commit()
    return SubIssuesSyncOut(imported=imported)


@router.post("/tasks/{task_id}/sync-issue-comments", response_model=IssueCommentsSyncOut)
def sync_task_github_issue_comments(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Pull GitHub issue comments into FlowDesk for this linked task."""
    task = _require_task(db, perms, task_id)
    if not task.github_issue_number:
        return IssueCommentsSyncOut(imported=0)
    repo = _active_repo_for_project(db, task.project_id)
    if not repo:
        return IssueCommentsSyncOut(imported=0)
    imported = github_service.sync_issue_comments_for_task(db, repo, task)
    if imported:
        db.commit()
    return IssueCommentsSyncOut(imported=imported)


@router.post("/tasks/{task_id}/issue-comment", response_model=CommentOut, status_code=201)
def post_task_github_issue_comment(
    task_id: uuid.UUID,
    body: IssueCommentBody,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Post a comment on the linked GitHub issue and store it on the task."""
    task = _require_task(db, perms, task_id)
    perms.require_task_edit(task)
    if not task.github_issue_number:
        raise HTTPException(status_code=400, detail="This task has no linked GitHub issue")
    project = perms.get_project_or_404(task.project_id)
    author_name = (
        perms.user.profile.full_name
        if perms.user.profile and perms.user.profile.full_name
        else perms.user.email
    )
    comment = github_service.create_synced_task_comment(
        db,
        task,
        project,
        perms.user.id,
        body.body.strip(),
        author_name=author_name,
    )
    db.commit()
    out = CommentOut.model_validate(comment)
    out.author = user_brief(db, perms.user.id)
    return out


@router.post("/tasks/{task_id}/close-issue", response_model=IssueStatusSyncOut)
def close_task_github_issue(
    task_id: uuid.UUID,
    body: IssueCommentBody | None = None,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Close the linked GitHub issue and move this task to Completed."""
    task = _require_task(db, perms, task_id)
    perms.require_task_edit(task)
    if not task.github_issue_number:
        raise HTTPException(status_code=400, detail="This task has no linked GitHub issue")
    repo = _active_repo_for_project(db, task.project_id)
    if not repo:
        raise HTTPException(
            status_code=400,
            detail="Link a repository to this project in App Center first.",
        )
    done = github_service.completed_status_for(db, task.project_id)
    org_id = _task_org_id(db, perms, task)
    personal = _personal_connection(db, org_id, perms.user.id)
    owner, repo_name = _parsed_repo(repo.repo_full_name)
    label_name = f"{github_api_service.FLOWDESK_LABEL_PREFIX}{done.name}" if done else None
    comment_text = body.body.strip() if body and body.body.strip() else None

    if comment_text:
        author_name = (
            perms.user.profile.full_name
            if perms.user.profile and perms.user.profile.full_name
            else perms.user.email
        )
        github_service.create_synced_task_comment(
            db,
            task,
            perms.get_project_or_404(task.project_id),
            perms.user.id,
            comment_text,
            author_name=author_name,
        )

    def run(token: str) -> bool:
        if comment_text:
            pass  # comment already synced via create_synced_task_comment
        github_api_service.update_issue_state(
            token,
            owner,
            repo_name,
            int(task.github_issue_number),
            "closed",
        )
        if done and label_name:
            try:
                github_api_service.sync_issue_status(
                    token,
                    owner,
                    repo_name,
                    int(task.github_issue_number),
                    state="closed",
                    label_name=label_name,
                    label_color=done.color,
                    mirror_state=False,
                )
            except Exception:
                pass
        return True

    _github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=run,
        failure_detail="Could not close issue on GitHub",
    )
    updated = github_service.apply_issue_state_to_task(
        db,
        repo,
        task,
        state="closed",
        actor=perms.user.email if perms.user else None,
        source="issue_closed",
    )
    db.commit()
    return IssueStatusSyncOut(
        updated=updated,
        status_id=str(task.status_id) if task.status_id else None,
    )


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
    perms.require_task_view(task)
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
    repo_ids = select(GithubRepository.id).where(
        GithubRepository.project_id == project_id,
        GithubRepository.is_active.is_(True),
        GithubRepository.deleted_at.is_(None),
    )
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


# ---------------------------------------------------------------------------
# Legacy GitHub-App installation endpoints (kept for backward compatibility)
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
        ws = perms.get_workspace_or_404(workspace_id)
        if ws.organization_id != installation.organization_id:
            raise HTTPException(
                status_code=403,
                detail="GitHub installation does not belong to this organization",
            )
    elif body.workspace_id:
        ws = perms.require_workspace_admin(body.workspace_id)
        workspace_id = body.workspace_id
        if ws.organization_id != installation.organization_id:
            raise HTTPException(
                status_code=403,
                detail="GitHub installation does not belong to this organization",
            )
    else:
        raise HTTPException(status_code=422, detail="Provide a project_id or workspace_id to connect")
    if body.project_id:
        _require_project_repo_slot(db, body.project_id)
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
