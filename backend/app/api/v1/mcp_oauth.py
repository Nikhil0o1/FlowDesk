import base64
import json
import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_auth_context, get_current_user_jwt, AuthContext, get_db
from app.core.api_token_scopes import PHASE1_SCOPES
from app.core.config import settings
from app.core.pat_route_registry import pat_allow
from app.models.user import User
from app.schemas.mcp_audit import McpAuditLogIn, McpAuditLogOut
from app.schemas.mcp_oauth import (
    McpConnectInfoOut,
    McpOAuthApproveIn,
    McpOAuthApproveOut,
    McpOAuthAuthRequestOut,
    McpOAuthClientRegisterIn,
    McpOAuthClientRegisterOut,
    McpOAuthIntrospectOut,
)
from app.services import mcp_audit_service, mcp_oauth_service

router = APIRouter(prefix="/oauth", tags=["mcp-oauth"])

mcp_router = APIRouter(prefix="/mcp", tags=["mcp"])


def _backend_base() -> str:
    return settings.public_backend_url


def _mcp_public_url() -> str:
    return settings.mcp_public_url


def _cursor_deeplink(mcp_url: str) -> str:
    # `name` is the server id in the query string — config must be transport-only.
    config = {"url": mcp_url}
    encoded = base64.b64encode(json.dumps(config, separators=(",", ":")).encode()).decode()
    return f"cursor://anysphere.cursor-deeplink/mcp/install?name=flowdesk&config={encoded}"


def _claude_desktop_deeplink(mcp_url: str) -> str:
    """Claude Desktop / claude.ai only — does not configure Claude Code in VS Code."""
    params = urlencode(
        {
            "modal": "add-custom-connector",
            "connectorName": "FlowDesk",
            "connectorUrl": mcp_url,
        }
    )
    return f"https://claude.ai/customize/connectors?{params}"


def _claude_code_install_command(mcp_url: str) -> str:
    """One command, any shell (PowerShell/bash/zsh). User scope covers the CLI and
    the VS Code / JetBrains extensions, which share ~/.claude.json."""
    return f"claude mcp add --transport http flowdesk {mcp_url} --scope user"


def _claude_code_reset_command(mcp_url: str) -> str:
    """Troubleshooting: clear stale flowdesk entries from every scope, re-add, verify."""
    return "\n".join(
        [
            "claude mcp remove flowdesk --scope user",
            "claude mcp remove flowdesk --scope local",
            "claude mcp remove flowdesk --scope project",
            f"claude mcp add --transport http flowdesk {mcp_url} --scope user",
            "claude mcp list",
        ]
    )


def _issuer() -> str:
    return _backend_base()


def _oauth_error(status_code: int, error: str, description: str | None = None) -> JSONResponse:
    """RFC 6749 error body — Cursor MCP rejects FastAPI-style {\"detail\": ...} responses."""
    body: dict[str, str] = {"error": error}
    if description:
        body["error_description"] = description
    return JSONResponse(status_code=status_code, content=body)


@router.get("/authorize")
def oauth_authorize(
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str | None = Query(None),
    code_challenge: str = Query(...),
    code_challenge_method: str = Query(...),
    state: str | None = Query(None),
    scope: str | None = Query(None),
    resource: str | None = Query(None),
    db: Session = Depends(get_db),
):
    if response_type != "code":
        raise HTTPException(status_code=400, detail="unsupported_response_type")
    if code_challenge_method != "S256":
        raise HTTPException(status_code=400, detail="invalid code_challenge_method")

    client = mcp_oauth_service.get_client(db, client_id)
    if client is None:
        raise HTTPException(status_code=400, detail="invalid_client")

    if redirect_uri is None:
        if len(client.redirect_uris) == 1:
            redirect_uri = client.redirect_uris[0]
        else:
            raise HTTPException(status_code=400, detail="redirect_uri required")
    try:
        mcp_oauth_service.validate_client_redirect(client, redirect_uri)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    scopes = mcp_oauth_service.parse_scopes(scope)
    try:
        auth_req = mcp_oauth_service.create_authorization_request(
            db,
            client_id=client_id,
            redirect_uri=redirect_uri,
            code_challenge=code_challenge,
            state=state,
            scopes=scopes,
            resource=resource,
        )
    except LookupError:
        raise HTTPException(status_code=400, detail="invalid_client") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()

    frontend = settings.public_frontend_url
    params = urlencode({"request_id": str(auth_req.id)})
    return RedirectResponse(url=f"{frontend}/oauth/mcp?{params}", status_code=302)


@router.post("/token")
async def oauth_token(
    request: Request,
    grant_type: str = Form(...),
    db: Session = Depends(get_db),
):
    if grant_type != "authorization_code":
        return _oauth_error(400, "unsupported_grant_type")

    form = await request.form()
    code = str(form.get("code", ""))
    code_verifier = str(form.get("code_verifier", ""))
    client_id = str(form.get("client_id", ""))
    redirect_uri = form.get("redirect_uri")
    if not code or not code_verifier or not client_id:
        return _oauth_error(400, "invalid_request", "Missing required parameters")

    try:
        access_token, scopes, expires_in = mcp_oauth_service.exchange_authorization_code(
            db,
            client_id=client_id,
            code=code,
            code_verifier=code_verifier,
            redirect_uri=str(redirect_uri) if redirect_uri else None,
        )
    except LookupError as exc:
        err = str(exc.args[0]) if exc.args else "invalid_grant"
        return _oauth_error(400, err)
    db.commit()

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": expires_in,
        "scope": " ".join(scopes),
    }


@router.post("/register", status_code=201)
def oauth_register_client(body: McpOAuthClientRegisterIn, db: Session = Depends(get_db)):
    try:
        record = mcp_oauth_service.register_client(
            db,
            client_name=body.client_name,
            redirect_uris=body.redirect_uris,
            token_endpoint_auth_method=body.token_endpoint_auth_method,
        )
    except ValueError as exc:
        return _oauth_error(400, "invalid_client_metadata", str(exc))
    db.commit()
    payload = McpOAuthClientRegisterOut(
        client_id=record.client_id,
        client_name=record.client_name,
        redirect_uris=record.redirect_uris,
        token_endpoint_auth_method=record.token_endpoint_auth_method,
        client_id_issued_at=record.client_id_issued_at,
        client_secret=None,
        client_secret_expires_at=record.client_secret_expires_at,
    )
    # Public clients (token_endpoint_auth_method=none) must omit secret fields — Cursor rejects null.
    return JSONResponse(status_code=201, content=payload.model_dump(exclude_none=True))


@router.post("/introspect", response_model=McpOAuthIntrospectOut)
def oauth_introspect(
    token: str = Form(...),
    db: Session = Depends(get_db),
):
    info = mcp_oauth_service.verify_access_token(db, token)
    if info is None:
        return McpOAuthIntrospectOut(active=False)
    user_id, scopes, expires_at = info
    return McpOAuthIntrospectOut(
        active=True,
        sub=str(user_id),
        client_id="flowdesk",
        scope=" ".join(scopes),
        exp=expires_at,
    )


@router.get("/mcp/requests/{request_id}", response_model=McpOAuthAuthRequestOut)
def get_mcp_auth_request(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    _ = user
    req = mcp_oauth_service.get_authorization_request(db, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Authorization request expired or not found")
    client = mcp_oauth_service.get_client(db, req.client_id)
    return McpOAuthAuthRequestOut(
        request_id=req.id,
        client_name=client.client_name if client else "MCP Client",
        scopes=req.scopes,
        resource=req.resource,
    )


@router.post("/mcp/approve", response_model=McpOAuthApproveOut)
def approve_mcp_auth(
    body: McpOAuthApproveIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    try:
        _, redirect_to = mcp_oauth_service.approve_authorization_request(
            db, request_id=body.request_id, user_id=user.id
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Authorization request expired or not found") from None
    db.commit()
    return McpOAuthApproveOut(redirect_to=redirect_to)


@mcp_router.get("/connect-info", response_model=McpConnectInfoOut)
def mcp_connect_info(user: User = Depends(get_current_user_jwt)):
    _ = user
    mcp_url = _mcp_public_url()
    backend = _backend_base()
    cursor_config = {"mcpServers": {"flowdesk": {"url": mcp_url}}}
    return McpConnectInfoOut(
        mcp_url=mcp_url,
        oauth_issuer=_issuer(),
        scopes_supported=sorted(PHASE1_SCOPES),
        cursor_deeplink=_cursor_deeplink(mcp_url),
        claude_desktop_deeplink=_claude_desktop_deeplink(mcp_url),
        claude_code_install_command=_claude_code_install_command(mcp_url),
        claude_code_reset_command=_claude_code_reset_command(mcp_url),
        cursor_config=cursor_config,
        claude_config=cursor_config,
    )


@mcp_router.post("/audit", status_code=204)
@pat_allow(
    "mcp:audit",
    rate_category="standard",
    authz_class="principal",
    tenant_resolution="MCP sidecar tool-invocation audit only",
)
def log_mcp_tool_audit(
    body: McpAuditLogIn,
    db: Session = Depends(get_db),
    ctx: AuthContext = Depends(get_auth_context),
):
    if ctx.kind != "pat":
        raise HTTPException(status_code=403, detail="MCP audit requires a personal access token")
    mcp_audit_service.log_invocation(
        db,
        user_id=ctx.user.id,
        token_id=ctx.pat.id if ctx.pat else None,
        tool=body.tool,
        args_hash=body.args_hash,
        status=body.status,
        http_status=body.http_status,
        resource_ids=body.resource_ids,
        error_message=body.error_message,
        duration_ms=body.duration_ms,
    )
    db.commit()


@mcp_router.get("/audit", response_model=list[McpAuditLogOut])
def list_mcp_tool_audit(
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_jwt),
):
    rows = mcp_audit_service.list_user_invocations(db, user.id, limit=limit)
    out: list[McpAuditLogOut] = []
    for row, prefix in rows:
        item = McpAuditLogOut.model_validate(row)
        item.token_prefix = prefix
        out.append(item)
    return out


def oauth_authorization_server_metadata() -> dict:
    return mcp_oauth_service.oauth_metadata(issuer=_issuer(), backend_url=_backend_base())


def oauth_protected_resource_metadata() -> dict:
    return mcp_oauth_service.protected_resource_metadata(
        mcp_url=_mcp_public_url(),
        backend_url=_backend_base(),
    )
