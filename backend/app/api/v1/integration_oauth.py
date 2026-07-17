"""ClickUp-shaped OAuth authorize / consent / token for integration apps."""

from __future__ import annotations

import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user_jwt
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.schemas.common import Message
from app.schemas.integration_oauth import (
    IntegrationOAuthApproveIn,
    IntegrationOAuthApproveOut,
    IntegrationOAuthAuthorizedAppOut,
    IntegrationOAuthAuthRequestOut,
    IntegrationOAuthTokenIn,
)
from app.services import integration_oauth_service as svc

router = APIRouter(prefix="/oauth/integrations", tags=["integration-oauth"])


def _oauth_error(status_code: int, error: str, description: str | None = None) -> JSONResponse:
    body: dict[str, str] = {"error": error}
    if description:
        body["error_description"] = description
    return JSONResponse(status_code=status_code, content=body)


@router.get("/authorize")
def integration_oauth_authorize(
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    state: str | None = Query(None),
    scope: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Start OAuth — mirrors ClickUp `https://app.clickup.com/api?client_id&redirect_uri&state`."""
    try:
        auth_req = svc.create_authorization_request(
            db,
            client_id=client_id,
            redirect_uri=redirect_uri,
            state=state,
            scope=scope,
        )
    except LookupError:
        raise HTTPException(status_code=400, detail="invalid_client") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()

    frontend = settings.public_frontend_url.rstrip("/")
    params = urlencode({"request_id": str(auth_req.id)})
    return RedirectResponse(url=f"{frontend}/oauth/integrations?{params}", status_code=302)


@router.get("/requests/{request_id}", response_model=IntegrationOAuthAuthRequestOut)
def get_integration_auth_request(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    _ = user
    req = svc.get_authorization_request(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Authorization request expired or not found")
    app = svc.get_active_app(db, req.client_id)
    return IntegrationOAuthAuthRequestOut(
        request_id=req.id,
        client_name=app.name if app else "Integration",
        client_id=req.client_id,
        organization_id=app.organization_id if app else None,
        scopes=list(req.scopes),
        redirect_uri=req.redirect_uri,
    )


@router.post("/approve", response_model=IntegrationOAuthApproveOut)
def approve_integration_auth(
    body: IntegrationOAuthApproveIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    try:
        redirect_to = svc.approve_authorization_request(
            db,
            request_id=body.request_id,
            user_id=user.id,
        )
    except LookupError as exc:
        err = str(exc.args[0]) if exc.args else "expired_request"
        raise HTTPException(status_code=400, detail=err) from exc
    except PermissionError:
        raise HTTPException(
            status_code=403,
            detail="You must be a member of the organization that owns this OAuth app",
        ) from None
    db.commit()
    return IntegrationOAuthApproveOut(redirect_to=redirect_to)


@router.post("/token")
async def integration_oauth_token(request: Request, db: Session = Depends(get_db)):
    """Exchange code for access_token — ClickUp JSON body: client_id, client_secret, code."""
    content_type = (request.headers.get("content-type") or "").lower()
    client_id = ""
    client_secret = ""
    code = ""

    if "application/json" in content_type:
        try:
            payload = await request.json()
        except Exception:
            return _oauth_error(400, "invalid_request", "Invalid JSON body")
        if not isinstance(payload, dict):
            return _oauth_error(400, "invalid_request", "JSON object required")
        try:
            body = IntegrationOAuthTokenIn.model_validate(payload)
        except Exception as exc:
            return _oauth_error(400, "invalid_request", str(exc))
        client_id = body.client_id
        client_secret = body.client_secret
        code = body.code
    else:
        form = await request.form()
        client_id = str(form.get("client_id", ""))
        client_secret = str(form.get("client_secret", ""))
        code = str(form.get("code", ""))

    if not client_id or not client_secret or not code:
        return _oauth_error(400, "invalid_request", "client_id, client_secret, and code are required")

    try:
        access_token, scopes = svc.exchange_authorization_code(
            db,
            client_id=client_id,
            client_secret=client_secret,
            code=code,
        )
    except LookupError as exc:
        err = str(exc.args[0]) if exc.args else "invalid_grant"
        status = 401 if err == "invalid_client" else 400
        return _oauth_error(status, err)
    db.commit()

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "scope": " ".join(scopes),
    }


@router.get("/authorized-apps", response_model=list[IntegrationOAuthAuthorizedAppOut])
def list_authorized_apps(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    """Custom Apps the current user has connected (API tokens tab — not org app registry)."""
    rows = svc.list_user_authorized_apps(db, user.id)
    return [IntegrationOAuthAuthorizedAppOut.model_validate(r) for r in rows]


@router.delete("/authorized-apps/{app_id}", response_model=Message)
def unauthorize_app(
    app_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    """Remove an authorized Custom App for the current user (revokes issued OAuth tokens)."""
    try:
        svc.unauthorize_user_app(db, user.id, app_id)
    except LookupError as exc:
        err = str(exc.args[0]) if exc.args else "not_found"
        raise HTTPException(status_code=404, detail=err) from exc
    db.commit()
    return Message(detail="App unauthorized")
