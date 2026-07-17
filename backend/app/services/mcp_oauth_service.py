"""MCP OAuth 2.1 authorization server (Cursor / Claude remote MCP connect)."""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.api_token_scopes import PHASE1_SCOPES, normalize_scopes
from app.core.security import generate_token, hash_token
from app.models.mcp_oauth import (
    McpOAuthAuthorizationCode,
    McpOAuthAuthorizationRequest,
    McpOAuthClient,
)

AUTH_CODE_TTL_MINUTES = 10
AUTH_REQUEST_TTL_MINUTES = 15

# Cursor MCP OAuth redirect URIs (desktop, deeplink, web/agents, CLI).
# https://cursor.com/docs/mcp — register all surfaces your users authenticate from.
CURSOR_REDIRECT_URIS = frozenset(
    {
        "cursor://anysphere.cursor-mcp/oauth/callback",
        "cursor://anysphere.cursor-deeplink/mcp/oauth/callback",
        "https://www.cursor.com/agents/mcp/oauth/callback",
        "http://localhost:8787/callback",
    }
)

CURSOR_WEB_CALLBACK_PATH = "/agents/mcp/oauth/callback"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_allowed_redirect_uri(uri: str) -> bool:
    if uri in CURSOR_REDIRECT_URIS:
        return True
    try:
        parsed = urlparse(uri)
    except Exception:
        return False
    if parsed.scheme in ("cursor", "claude"):
        return True
    host = (parsed.hostname or "").lower()
    if host == "www.cursor.com" and parsed.scheme == "https":
        return parsed.path == CURSOR_WEB_CALLBACK_PATH
    if host in ("localhost", "127.0.0.1", "[::1]"):
        return parsed.scheme in ("http", "https")
    return False


def redirect_uri_matches(requested: str, registered: str) -> bool:
    if requested == registered:
        return True
    try:
        req = urlparse(requested)
        reg = urlparse(registered)
    except Exception:
        return False
    loopback = {"localhost", "127.0.0.1", "[::1]"}
    if req.hostname not in loopback or reg.hostname not in loopback:
        return False
    return (
        req.scheme == reg.scheme
        and req.hostname == reg.hostname
        and req.path == reg.path
        and req.query == reg.query
    )


def verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return secrets.compare_digest(computed, code_challenge)


def parse_scopes(scope: str | None) -> list[str]:
    """Parse OAuth scope string. Empty/missing → [] (must be requested explicitly)."""
    if not scope or not scope.strip():
        return []
    parts = [s.strip() for s in scope.split() if s.strip()]
    return normalize_scopes(parts)


def get_client(db: Session, client_id: str) -> McpOAuthClient | None:
    return db.scalar(select(McpOAuthClient).where(McpOAuthClient.client_id == client_id))


def register_client(
    db: Session,
    *,
    client_name: str,
    redirect_uris: list[str],
    token_endpoint_auth_method: str = "none",
    client_id: str | None = None,
    client_secret: str | None = None,
) -> McpOAuthClient:
    if not redirect_uris:
        raise ValueError("redirect_uris is required")
    bad = [u for u in redirect_uris if not _is_allowed_redirect_uri(u)]
    if bad:
        raise ValueError(f"redirect_uri not allowed: {bad[0]}")
    if token_endpoint_auth_method not in ("none", "client_secret_post", "client_secret_basic"):
        raise ValueError("Unsupported token_endpoint_auth_method")

    issued_at = int(_now().timestamp())
    record = McpOAuthClient(
        client_id=client_id or str(uuid.uuid4()),
        client_secret_hash=hash_token(client_secret) if client_secret else None,
        client_name=client_name.strip() or "MCP Client",
        redirect_uris=redirect_uris,
        token_endpoint_auth_method=token_endpoint_auth_method,
        client_id_issued_at=issued_at,
        client_secret_expires_at=None if token_endpoint_auth_method == "none" else issued_at + 30 * 24 * 3600,
    )
    db.add(record)
    db.flush()
    return record


def validate_client_redirect(client: McpOAuthClient, redirect_uri: str) -> None:
    if not any(redirect_uri_matches(redirect_uri, reg) for reg in client.redirect_uris):
        raise ValueError("Unregistered redirect_uri")


def create_authorization_request(
    db: Session,
    *,
    client_id: str,
    redirect_uri: str,
    code_challenge: str,
    state: str | None,
    scopes: list[str],
    resource: str | None,
) -> McpOAuthAuthorizationRequest:
    client = get_client(db, client_id)
    if client is None:
        raise LookupError("invalid_client")
    validate_client_redirect(client, redirect_uri)
    normalized = normalize_scopes(scopes)
    record = McpOAuthAuthorizationRequest(
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        state=state,
        scopes=normalized,
        resource=resource,
        expires_at=_now() + timedelta(minutes=AUTH_REQUEST_TTL_MINUTES),
    )
    db.add(record)
    db.flush()
    return record


def get_authorization_request(db: Session, request_id: uuid.UUID) -> McpOAuthAuthorizationRequest | None:
    record = db.get(McpOAuthAuthorizationRequest, request_id)
    if record is None or record.expires_at <= _now():
        return None
    return record


def approve_authorization_request(
    db: Session,
    *,
    request_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[str, str]:
    """Return (raw_authorization_code, redirect_uri_with_query)."""
    req = get_authorization_request(db, request_id)
    if req is None:
        raise LookupError("expired_request")

    raw_code = generate_token()
    code_record = McpOAuthAuthorizationCode(
        code_hash=hash_token(raw_code),
        client_id=req.client_id,
        user_id=user_id,
        redirect_uri=req.redirect_uri,
        code_challenge=req.code_challenge,
        scopes=req.scopes,
        resource=req.resource,
        expires_at=_now() + timedelta(minutes=AUTH_CODE_TTL_MINUTES),
    )
    db.add(code_record)
    db.delete(req)
    db.flush()

    params: dict[str, str] = {"code": raw_code}
    if req.state:
        params["state"] = req.state
    redirect = f"{req.redirect_uri}?{urlencode(params)}"
    return raw_code, redirect


def exchange_authorization_code(
    db: Session,
    *,
    client_id: str,
    code: str,
    code_verifier: str,
    redirect_uri: str | None,
) -> tuple[str, list[str], int]:
    """Validate code + PKCE and mint a PAT. Returns (access_token, scopes, expires_in_seconds)."""
    from app.services import api_token_service

    client = get_client(db, client_id)
    if client is None:
        raise LookupError("invalid_client")

    code_hash = hash_token(code)
    record = db.scalar(
        select(McpOAuthAuthorizationCode).where(McpOAuthAuthorizationCode.code_hash == code_hash)
    )
    if record is None or record.used_at is not None or record.expires_at <= _now():
        raise LookupError("invalid_grant")
    if record.client_id != client_id:
        raise LookupError("invalid_grant")
    if redirect_uri and not redirect_uri_matches(redirect_uri, record.redirect_uri):
        raise LookupError("invalid_grant")
    if not verify_pkce(code_verifier, record.code_challenge):
        raise LookupError("invalid_grant")

    record.used_at = _now()
    expires_in_days = 90
    # Always include mcp:audit for sidecar invocation logging (operational only).
    scopes = list(dict.fromkeys([*record.scopes, "mcp:audit"]))
    if not scopes or scopes == ["mcp:audit"]:
        # Consent must request tool scopes; refuse minting a useless empty MCP token.
        raise LookupError("invalid_scope")
    raw_pat, pat = api_token_service.create_pat(
        db,
        user_id=record.user_id,
        name="MCP connection",
        scopes=scopes,
        expires_in_days=expires_in_days,
    )
    record.pat_id = pat.id
    db.flush()

    expires_in = expires_in_days * 24 * 3600
    if pat.expires_at:
        expires_in = max(0, int((pat.expires_at - _now()).total_seconds()))
    return raw_pat, list(pat.scopes), expires_in


def verify_access_token(db: Session, token: str) -> tuple[uuid.UUID, list[str], int | None] | None:
    from app.services import api_token_service

    pat = api_token_service.verify_pat(db, token)
    if pat is None:
        return None
    expires_at = int(pat.expires_at.timestamp()) if pat.expires_at else None
    return pat.user_id, list(pat.scopes), expires_at


def oauth_metadata(*, issuer: str, backend_url: str) -> dict:
    base = backend_url.rstrip("/")
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{base}/api/v1/oauth/authorize",
        "token_endpoint": f"{base}/api/v1/oauth/token",
        "registration_endpoint": f"{base}/api/v1/oauth/register",
        "scopes_supported": sorted(PHASE1_SCOPES),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "introspection_endpoint": f"{base}/api/v1/oauth/introspect",
    }


def protected_resource_metadata(*, mcp_url: str, backend_url: str) -> dict:
    issuer = backend_url.rstrip("/")
    return {
        "resource": mcp_url.rstrip("/"),
        "authorization_servers": [issuer],
        "scopes_supported": sorted(PHASE1_SCOPES),
        "bearer_methods_supported": ["header"],
        "resource_name": "FlowDesk",
    }
