"""Org-admin CRUD for integration OAuth apps (ClickUp-style Custom Apps)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_jwt, get_permissions
from app.core.rate_limit import limiter, trusted_client_ip
from app.db.session import get_db
from app.models.integration_oauth import IntegrationOAuthApp
from app.models.user import User
from app.schemas.common import Message
from app.schemas.integration_oauth import (
    IntegrationOAuthAppCreate,
    IntegrationOAuthAppCreatedOut,
    IntegrationOAuthAppOut,
    IntegrationOAuthAppUpdate,
)
from app.services import integration_oauth_service as svc
from app.services.audit_service import audit
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/organizations/{org_id}/oauth-apps", tags=["oauth-apps"])


def _app_or_404(db: Session, org_id: uuid.UUID, app_id: uuid.UUID) -> IntegrationOAuthApp:
    app = db.get(IntegrationOAuthApp, app_id)
    if app is None or app.organization_id != org_id:
        raise HTTPException(status_code=404, detail="OAuth app not found")
    return app


def _created_out(app: IntegrationOAuthApp, raw_secret: str) -> IntegrationOAuthAppCreatedOut:
    primary_redirect = app.redirect_uris[0] if app.redirect_uris else None
    return IntegrationOAuthAppCreatedOut(
        id=app.id,
        organization_id=app.organization_id,
        name=app.name,
        client_id=app.client_id,
        redirect_uris=list(app.redirect_uris),
        default_scopes=list(app.default_scopes),
        display_suffix=app.display_suffix,
        created_at=app.created_at,
        updated_at=app.updated_at,
        revoked_at=app.revoked_at,
        client_secret=raw_secret,
        env_snippet=svc.env_snippet(
            client_id=app.client_id,
            client_secret=raw_secret,
            redirect_uri=primary_redirect,
        ),
        authorize_url_template=svc.authorize_url_template(),
        token_url=svc.token_url(),
    )


@router.get("", response_model=list[IntegrationOAuthAppOut])
def list_oauth_apps(
    org_id: uuid.UUID,
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    apps = svc.list_org_apps(db, org_id, include_revoked=include_revoked)
    return [IntegrationOAuthAppOut.model_validate(a) for a in apps]


@router.post("", response_model=IntegrationOAuthAppCreatedOut, status_code=201)
@limiter.limit("20/minute")
def create_oauth_app(
    request: Request,
    org_id: uuid.UUID,
    body: IntegrationOAuthAppCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    try:
        raw_secret, app = svc.create_app(
            db,
            organization_id=org_id,
            created_by_user_id=user.id,
            name=body.name,
            redirect_uris=body.redirect_uris,
            default_scopes=body.default_scopes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit(
        db,
        "oauth_app.created",
        organization_id=org_id,
        actor_id=user.id,
        target_type="integration_oauth_app",
        target_id=app.id,
        data={"name": app.name, "client_id": app.client_id},
        ip_address=trusted_client_ip(request),
    )
    db.commit()
    db.refresh(app)
    return _created_out(app, raw_secret)


@router.get("/{app_id}", response_model=IntegrationOAuthAppOut)
def get_oauth_app(
    org_id: uuid.UUID,
    app_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    return IntegrationOAuthAppOut.model_validate(_app_or_404(db, org_id, app_id))


@router.patch("/{app_id}", response_model=IntegrationOAuthAppOut)
def update_oauth_app(
    org_id: uuid.UUID,
    app_id: uuid.UUID,
    body: IntegrationOAuthAppUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    app = _app_or_404(db, org_id, app_id)
    try:
        app = svc.update_app(
            db,
            app,
            name=body.name,
            redirect_uris=body.redirect_uris,
            default_scopes=body.default_scopes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit(
        db,
        "oauth_app.updated",
        organization_id=org_id,
        actor_id=user.id,
        target_type="integration_oauth_app",
        target_id=app.id,
        data={"name": app.name},
    )
    db.commit()
    db.refresh(app)
    return IntegrationOAuthAppOut.model_validate(app)


@router.post("/{app_id}/regenerate-secret", response_model=IntegrationOAuthAppCreatedOut)
@limiter.limit("10/minute")
def regenerate_oauth_app_secret(
    request: Request,
    org_id: uuid.UUID,
    app_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    app = _app_or_404(db, org_id, app_id)
    try:
        raw_secret, app = svc.regenerate_secret(db, app)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit(
        db,
        "oauth_app.secret_regenerated",
        organization_id=org_id,
        actor_id=user.id,
        target_type="integration_oauth_app",
        target_id=app.id,
        ip_address=trusted_client_ip(request),
    )
    db.commit()
    db.refresh(app)
    return _created_out(app, raw_secret)


@router.delete("/{app_id}", response_model=Message)
def revoke_oauth_app(
    org_id: uuid.UUID,
    app_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_org_admin(org_id)
    app = _app_or_404(db, org_id, app_id)
    svc.revoke_app(db, app)
    audit(
        db,
        "oauth_app.revoked",
        organization_id=org_id,
        actor_id=user.id,
        target_type="integration_oauth_app",
        target_id=app.id,
        data={"client_id": app.client_id},
    )
    db.commit()
    return Message(detail="OAuth app revoked")
