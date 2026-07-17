import uuid
from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.api_errors import (
    INSUFFICIENT_SCOPE,
    INVALID_CREDENTIALS,
    PAT_NOT_ALLOWED,
    PatApiError,
)
from app.core.api_token_scopes import scopes_satisfy_all
from app.core.pat_audit import record_denial_aggregate
from app.core.pat_rate_limit import check_ip_limit, check_pat_limits
from app.core.pat_route_registry import endpoint_pat_meta
from app.core.pat_usage import record_pat_usage
from app.core.rate_limit import trusted_client_ip
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.api_token import PersonalAccessToken
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.models.workspace import Workspace
from app.services import api_token_service, auth_service
from app.services.permission_service import PermissionService

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthContext:
    user: User
    kind: Literal["jwt", "pat"]
    pat: PersonalAccessToken | None = None

    @property
    def scopes(self) -> list[str]:
        if self.pat is not None:
            return list(self.pat.scopes)
        return []


def _invalid_credentials() -> PatApiError:
    return PatApiError(
        status.HTTP_401_UNAUTHORIZED,
        INVALID_CREDENTIALS,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _load_active_user(db: Session, user_id: uuid.UUID) -> User | None:
    user = db.get(User, user_id)
    if not user or not user.is_active or user.deleted_at is not None:
        return None
    return user


def resolve_target_organization_id(db: Session, request: Request) -> uuid.UUID | None:
    """Securely resolve the request's target organization from path params / object parents."""
    params = request.path_params

    org_raw = params.get("org_id") or params.get("organization_id")
    if org_raw:
        try:
            return uuid.UUID(str(org_raw))
        except ValueError:
            return None

    workspace_raw = params.get("workspace_id")
    if workspace_raw:
        try:
            ws = db.get(Workspace, uuid.UUID(str(workspace_raw)))
            return ws.organization_id if ws else None
        except ValueError:
            return None

    project_raw = params.get("project_id")
    if project_raw:
        try:
            project = db.get(Project, uuid.UUID(str(project_raw)))
            if not project:
                return None
            ws = db.get(Workspace, project.workspace_id)
            return ws.organization_id if ws else None
        except ValueError:
            return None

    task_raw = params.get("task_id")
    if task_raw:
        try:
            task = db.get(Task, uuid.UUID(str(task_raw)))
            if not task:
                return None
            project = db.get(Project, task.project_id)
            if not project:
                return None
            ws = db.get(Workspace, project.workspace_id)
            return ws.organization_id if ws else None
        except ValueError:
            return None

    return None


def _matched_endpoint(request: Request):
    route = request.scope.get("route")
    return getattr(route, "endpoint", None) if route is not None else None


def _pat_route_path(request: Request) -> str:
    return str(getattr(request.scope.get("route"), "path", request.url.path))


def _mark_pat_usage_context(request: Request, token_id, *, route: str | None = None) -> None:
    request.state.pat_usage_pending = True
    request.state.pat_token_id = token_id
    request.state.pat_route = route or _pat_route_path(request)
    request.state.pat_ip = trusted_client_ip(request)


def _record_pat_denial(request: Request, token_id, *, status_code: int, event: str) -> None:
    route = _pat_route_path(request)
    _mark_pat_usage_context(request, token_id, route=route)
    record_pat_usage(
        token_id=token_id,
        route=route,
        status_code=status_code,
        ip_address=trusted_client_ip(request),
        event=event,
    )
    request.state.pat_usage_recorded = True


def _enforce_pat_route(
    request: Request,
    db: Session,
    ctx: AuthContext,
) -> None:
    assert ctx.pat is not None
    endpoint = _matched_endpoint(request)
    meta = endpoint_pat_meta(endpoint)
    route_path = _pat_route_path(request)

    if meta is None:
        record_denial_aggregate(
            event="pat.route_denied",
            token_id=ctx.pat.id,
            route=str(route_path),
        )
        _record_pat_denial(request, ctx.pat.id, status_code=403, event="failed")
        raise PatApiError(status.HTTP_403_FORBIDDEN, PAT_NOT_ALLOWED)

    required = meta["scopes"]
    if not scopes_satisfy_all(ctx.scopes, required):
        record_denial_aggregate(
            event="pat.scope_denied",
            token_id=ctx.pat.id,
            route=str(route_path),
            extra={"required": sorted(required)},
        )
        _record_pat_denial(request, ctx.pat.id, status_code=403, event="failed")
        raise PatApiError(status.HTTP_403_FORBIDDEN, INSUFFICIENT_SCOPE)

    org_id = None
    if meta["authz_class"] != "principal":
        org_id = resolve_target_organization_id(db, request)

    try:
        check_pat_limits(
            token_id=ctx.pat.id,
            organization_id=org_id,
            category=meta["rate_category"],
            request=request,
        )
    except PatApiError as exc:
        if exc.status_code == 429:
            _record_pat_denial(request, ctx.pat.id, status_code=429, event="rate_limited")
        raise

    _mark_pat_usage_context(request, ctx.pat.id, route=route_path)


def _authenticate(
    credentials: HTTPAuthorizationCredentials,
    db: Session,
    request: Request,
) -> AuthContext:
    raw = credentials.credentials

    if api_token_service.is_pat_shaped(raw):
        try:
            check_ip_limit(request, "auth_fail")
        except PatApiError:
            raise

        pat = api_token_service.verify_pat(db, raw)
        if pat is None:
            raise _invalid_credentials()

        user = _load_active_user(db, pat.user_id)
        if user is None:
            raise _invalid_credentials()

        api_token_service.maybe_migrate_pepper(db, pat, raw)
        api_token_service.touch_last_used(db, pat)
        db.commit()

        ctx = AuthContext(user=user, kind="pat", pat=pat)
        _enforce_pat_route(request, db, ctx)
        return ctx

    payload = decode_access_token(raw)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if auth_service.is_access_token_revoked(db, payload.get("jti")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = _load_active_user(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is not active",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return AuthContext(user=user, kind="jwt")


def get_auth_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthContext:
    if credentials is None:
        raise PatApiError(
            status.HTTP_401_UNAUTHORIZED,
            INVALID_CREDENTIALS,
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _authenticate(credentials, db, request)


def get_current_user(ctx: AuthContext = Depends(get_auth_context)) -> User:
    return ctx.user


def get_current_user_jwt(ctx: AuthContext = Depends(get_auth_context)) -> User:
    """Session JWT only — PATs cannot mint or revoke other tokens."""
    if ctx.kind != "jwt":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Personal access tokens cannot manage API tokens. Sign in via the app.",
        )
    return ctx.user


def get_permissions(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PermissionService:
    return PermissionService(db, user)


def require_pat_scopes(*required: str):
    """Optional guard for endpoints when authenticated via PAT (legacy helper)."""

    def _dep(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if ctx.kind == "pat":
            missing = [s for s in required if s not in ctx.scopes]
            if missing:
                raise PatApiError(status.HTTP_403_FORBIDDEN, INSUFFICIENT_SCOPE)
        return ctx

    return _dep


def get_superadmin(user: User = Depends(get_current_user)) -> User:
    if not user.is_platform_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform superadmin access required")
    return user
