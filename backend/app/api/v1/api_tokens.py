import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_jwt, get_db
from app.core.api_scope_catalog import public_scope_catalog
from app.core.config import settings
from app.core.pat_audit import audit_pat_secret_acknowledged
from app.core.pat_route_registry import collect_pat_routes
from app.core.public_openapi import build_public_openapi, public_rate_limit_catalog
from app.core.rate_limit import trusted_client_ip
from app.models.user import User
from app.schemas.api_token import (
    ApiPublicRouteOut,
    ApiRateLimitOut,
    ApiScopeOut,
    ApiTokenCreate,
    ApiTokenCreatedOut,
    ApiTokenMetaOut,
    ApiTokenOut,
    ApiTokenRename,
    ApiTokenRotate,
    ApiTokenUsageOut,
)
from app.schemas.common import Message
from app.services import api_token_service
from app.services.pat_usage_service import build_token_usage

router = APIRouter(prefix="/users/me/api-tokens", tags=["api-tokens"])


def _out(record) -> ApiTokenOut:
    return ApiTokenOut.model_validate(record)


@router.get("/meta", response_model=ApiTokenMetaOut)
def api_token_meta(
    request: Request,
    user: User = Depends(get_current_user_jwt),
):
    """Safe scope catalog, rate limits, and public route inventory. JWT only."""
    _ = user
    rows = collect_pat_routes(request.app)
    return ApiTokenMetaOut(
        scopes=[ApiScopeOut(**row) for row in public_scope_catalog()],
        max_lifetime_days=settings.PAT_MAX_LIFETIME_DAYS,
        rotation_grace_seconds=settings.PAT_ROTATION_GRACE_SECONDS,
        resource_restrictions_supported=False,
        identity_model="user_bound",
        api_version="1.0.0",
        base_path="/api/v1",
        rate_limits=[ApiRateLimitOut(**row) for row in public_rate_limit_catalog()],
        public_routes=[
            ApiPublicRouteOut(
                methods=r["methods"],
                path=r["path"],
                scopes=r["scopes"],
                rate_category=r["rate_category"],
                authz_class=r["authz_class"],
                tenant_resolution=r["tenant_resolution"] or "",
            )
            for r in rows
        ],
    )


@router.get("/public-openapi")
def api_token_public_openapi(
    request: Request,
    user: User = Depends(get_current_user_jwt),
):
    """Filtered OpenAPI document for PAT-enabled routes only. JWT only."""
    _ = user
    return JSONResponse(build_public_openapi(request.app))



@router.get("", response_model=list[ApiTokenOut])
def list_my_api_tokens(
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    tokens = api_token_service.list_user_tokens(db, user.id)
    if include_revoked:
        return [_out(t) for t in tokens]
    return [_out(t) for t in tokens if t.revoked_at is None]


@router.get("/{token_id}", response_model=ApiTokenOut)
def get_my_api_token(
    token_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    try:
        record = api_token_service.get_user_token(db, user.id, token_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Token not found") from exc
    return _out(record)


@router.get("/{token_id}/usage", response_model=ApiTokenUsageOut)
def get_my_api_token_usage(
    token_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    """Support-oriented usage dashboard for one key. JWT only. No secrets."""
    try:
        record = api_token_service.get_user_token(db, user.id, token_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Token not found") from exc
    return ApiTokenUsageOut(**build_token_usage(db, record))


@router.post("/{token_id}/usage/ack-copied", response_model=Message)
def ack_api_token_secret_copied(
    token_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    """Record that the user acknowledged saving the one-time secret. JWT only."""
    try:
        api_token_service.get_user_token(db, user.id, token_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Token not found") from exc
    audit_pat_secret_acknowledged(
        db,
        actor_id=user.id,
        token_id=token_id,
        ip_address=trusted_client_ip(request),
    )
    db.commit()
    return Message(detail="Acknowledged")


@router.post("", response_model=ApiTokenCreatedOut, status_code=201)
def create_api_token(
    body: ApiTokenCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    try:
        raw, record = api_token_service.create_pat(
            db,
            user_id=user.id,
            name=body.name,
            scopes=body.scopes,
            expires_in_days=body.expires_in_days,
            ip_address=trusted_client_ip(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    db.refresh(record)
    base = _out(record).model_dump()
    return ApiTokenCreatedOut(**base, token=raw)


@router.patch("/{token_id}", response_model=ApiTokenOut)
def rename_api_token(
    token_id: uuid.UUID,
    body: ApiTokenRename,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    try:
        record = api_token_service.rename_token(db, user.id, token_id, name=body.name)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Token not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    db.refresh(record)
    return _out(record)


@router.post("/{token_id}/rotate", response_model=ApiTokenCreatedOut)
def rotate_api_token(
    token_id: uuid.UUID,
    body: ApiTokenRotate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    try:
        raw, record = api_token_service.rotate_token(
            db,
            user.id,
            token_id,
            scopes=body.scopes,
            ip_address=trusted_client_ip(request),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Token not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    db.refresh(record)
    base = _out(record).model_dump()
    return ApiTokenCreatedOut(**base, token=raw)


@router.delete("/{token_id}", response_model=Message)
def revoke_api_token(
    token_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    try:
        api_token_service.revoke_token(
            db,
            user.id,
            token_id,
            ip_address=trusted_client_ip(request),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Token not found") from exc
    db.commit()
    return Message(detail="Token revoked")
