"""Integration OAuth apps — ClickUp-shaped authorize / token for Holocron & similar."""

from __future__ import annotations

import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.api_key_digest import (
    digest_v1_secret,
    get_current_pepper_version,
    resolve_pepper,
)
from app.core.api_token_scopes import PHASE1_SCOPES, normalize_scopes
from app.core.config import settings
from app.core.security import generate_token, hash_token
from app.models.api_token import PersonalAccessToken
from app.models.integration_oauth import (
    CLIENT_ID_PREFIX,
    IntegrationOAuthApp,
    IntegrationOAuthAuthCode,
    IntegrationOAuthAuthRequest,
)
from app.models.organization import OrganizationMember
from app.models.workspace import Workspace, WorkspaceMember

AUTH_REQUEST_TTL_MINUTES = 15
AUTH_CODE_TTL_MINUTES = 10
MAX_APPS_PER_ORG = 25
HASH_VERSION_V1 = 1

# Default scopes for Holocron-style integrations (Phase 1 public surface).
DEFAULT_INTEGRATION_SCOPES: list[str] = sorted(
    s for s in PHASE1_SCOPES if s != "mcp:audit"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_public_id(length: int = 12) -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _resolve_pepper_for_issue() -> tuple[int, bytes]:
    pepper_version = get_current_pepper_version()
    pepper = resolve_pepper(pepper_version)
    if pepper is None:
        if not settings.is_production and not settings.API_KEY_PEPPERS.strip():
            return 1, b"dev-only-pat-pepper"
        raise ValueError("API_KEY_PEPPER_CURRENT has no matching entry in API_KEY_PEPPERS")
    return pepper_version, pepper


def _mint_client_secret() -> tuple[str, str, str, str, int]:
    """Return (raw_secret, secret_public_id, digest, display_suffix, pepper_version)."""
    pepper_version, pepper = _resolve_pepper_for_issue()
    secret_public_id = _new_public_id(12)
    secret = secrets.token_urlsafe(32)
    raw = f"fd_appsec_{secret_public_id}_{secret}"
    digest = digest_v1_secret(secret, pepper)
    return raw, secret_public_id, digest, secret[-4:], pepper_version


def _parse_client_secret(raw: str) -> tuple[str, str] | None:
    prefix = "fd_appsec_"
    if not raw.startswith(prefix):
        return None
    rest = raw[len(prefix) :]
    parts = rest.split("_", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]


def verify_client_secret(app: IntegrationOAuthApp, raw_secret: str) -> bool:
    parsed = _parse_client_secret(raw_secret.strip())
    if parsed is None:
        return False
    public_id, secret = parsed
    if public_id != app.secret_public_id:
        return False
    pepper = resolve_pepper(app.pepper_version)
    if pepper is None:
        if (
            not settings.is_production
            and not settings.API_KEY_PEPPERS.strip()
            and app.pepper_version == 1
        ):
            pepper = b"dev-only-pat-pepper"
        else:
            return False
    expected = digest_v1_secret(secret, pepper)
    return hmac.compare_digest(expected, app.secret_digest)


def env_snippet(
    *,
    client_id: str,
    client_secret: str,
    redirect_uri: str | None = None,
) -> str:
    backend = settings.public_backend_url.rstrip("/")
    rd = redirect_uri or "https://<your-app-host>/oauth/callback"
    webhook = "https://<your-app-host>/webhooks/flowdesk"
    # Derive suggested webhook from redirect host when the common Holocron-style path is used
    if redirect_uri:
        for marker in (
            "/api/v1/tools/config/oauth/callback",
            "/oauth/callback",
            "/api/v1/oauth/callback",
        ):
            if marker in redirect_uri:
                base = redirect_uri.split(marker)[0]
                webhook = f"{base}/api/v1/webhooks/flowdesk"
                break
    return "\n".join(
        [
            f"FLOWDESK_CLIENT_ID={client_id}",
            f"FLOWDESK_CLIENT_SECRET={client_secret}",
            f"FLOWDESK_REDIRECT_URI={rd}",
            f"FLOWDESK_WEBHOOK_BASE_URL={webhook}",
            f"FLOWDESK_DEFAULT_BASE_URL={backend}/api/v1",
        ]
    )


def authorize_url_template() -> str:
    backend = settings.public_backend_url.rstrip("/")
    return (
        f"{backend}/api/v1/oauth/integrations/authorize"
        "?client_id={client_id}&redirect_uri={redirect_uri}&state={state}"
    )


def token_url() -> str:
    return f"{settings.public_backend_url.rstrip('/')}/api/v1/oauth/integrations/token"


def get_app_by_client_id(db: Session, client_id: str) -> IntegrationOAuthApp | None:
    return db.scalar(
        select(IntegrationOAuthApp).where(IntegrationOAuthApp.client_id == client_id)
    )


def get_active_app(db: Session, client_id: str) -> IntegrationOAuthApp | None:
    app = get_app_by_client_id(db, client_id)
    if app is None or app.revoked_at is not None:
        return None
    return app


def list_org_apps(
    db: Session, organization_id: uuid.UUID, *, include_revoked: bool = False
) -> list[IntegrationOAuthApp]:
    q = select(IntegrationOAuthApp).where(
        IntegrationOAuthApp.organization_id == organization_id
    )
    if not include_revoked:
        q = q.where(IntegrationOAuthApp.revoked_at.is_(None))
    q = q.order_by(IntegrationOAuthApp.created_at.desc())
    return list(db.scalars(q).all())


def create_app(
    db: Session,
    *,
    organization_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
    name: str,
    redirect_uris: list[str],
    default_scopes: list[str] | None = None,
) -> tuple[str, IntegrationOAuthApp]:
    active = list_org_apps(db, organization_id, include_revoked=False)
    if len(active) >= MAX_APPS_PER_ORG:
        raise ValueError(f"Maximum of {MAX_APPS_PER_ORG} active OAuth apps per organization")

    scopes = normalize_scopes(default_scopes if default_scopes is not None else DEFAULT_INTEGRATION_SCOPES)
    if not scopes:
        raise ValueError("default_scopes cannot be empty")
    # Integration tokens should not require mcp:audit
    scopes = [s for s in scopes if s in PHASE1_SCOPES and s != "mcp:audit"]
    if not scopes:
        raise ValueError("No valid Phase 1 scopes selected")

    raw_secret, secret_public_id, digest, display_suffix, pepper_version = _mint_client_secret()
    client_id = f"{CLIENT_ID_PREFIX}{_new_public_id(24).upper()}"

    record = IntegrationOAuthApp(
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        name=name.strip(),
        client_id=client_id,
        secret_public_id=secret_public_id,
        secret_digest=digest,
        hash_version=HASH_VERSION_V1,
        pepper_version=pepper_version,
        display_suffix=display_suffix,
        redirect_uris=list(redirect_uris),
        default_scopes=scopes,
    )
    db.add(record)
    db.flush()
    return raw_secret, record


def update_app(
    db: Session,
    app: IntegrationOAuthApp,
    *,
    name: str | None = None,
    redirect_uris: list[str] | None = None,
    default_scopes: list[str] | None = None,
) -> IntegrationOAuthApp:
    if app.revoked_at is not None:
        raise ValueError("Cannot update a revoked app")
    if name is not None:
        app.name = name.strip()
    if redirect_uris is not None:
        app.redirect_uris = list(redirect_uris)
    if default_scopes is not None:
        scopes = normalize_scopes(default_scopes)
        scopes = [s for s in scopes if s in PHASE1_SCOPES and s != "mcp:audit"]
        if not scopes:
            raise ValueError("default_scopes cannot be empty")
        app.default_scopes = scopes
    db.flush()
    return app


def regenerate_secret(db: Session, app: IntegrationOAuthApp) -> tuple[str, IntegrationOAuthApp]:
    if app.revoked_at is not None:
        raise ValueError("Cannot regenerate secret for a revoked app")
    raw_secret, secret_public_id, digest, display_suffix, pepper_version = _mint_client_secret()
    app.secret_public_id = secret_public_id
    app.secret_digest = digest
    app.hash_version = HASH_VERSION_V1
    app.pepper_version = pepper_version
    app.display_suffix = display_suffix
    db.flush()
    return raw_secret, app


def revoke_app(db: Session, app: IntegrationOAuthApp) -> IntegrationOAuthApp:
    if app.revoked_at is None:
        app.revoked_at = _now()
        db.flush()
    return app


def validate_redirect_uri(app: IntegrationOAuthApp, redirect_uri: str) -> None:
    if redirect_uri not in app.redirect_uris:
        raise ValueError("Unregistered redirect_uri")


def create_authorization_request(
    db: Session,
    *,
    client_id: str,
    redirect_uri: str,
    state: str | None,
    scope: str | None,
) -> IntegrationOAuthAuthRequest:
    app = get_active_app(db, client_id)
    if app is None:
        raise LookupError("invalid_client")
    validate_redirect_uri(app, redirect_uri)

    if scope and scope.strip():
        requested = normalize_scopes([s for s in scope.split() if s.strip()])
        allowed = set(app.default_scopes)
        if not set(requested).issubset(allowed):
            raise ValueError("requested scopes exceed app default_scopes")
        scopes = requested
    else:
        scopes = list(app.default_scopes)

    if not scopes:
        raise ValueError("no scopes available")

    record = IntegrationOAuthAuthRequest(
        client_id=client_id,
        redirect_uri=redirect_uri,
        state=state,
        scopes=scopes,
        expires_at=_now() + timedelta(minutes=AUTH_REQUEST_TTL_MINUTES),
    )
    db.add(record)
    db.flush()
    return record


def get_authorization_request(
    db: Session, request_id: uuid.UUID
) -> IntegrationOAuthAuthRequest | None:
    record = db.get(IntegrationOAuthAuthRequest, request_id)
    if record is None or record.expires_at <= _now():
        return None
    return record


def user_is_org_member(db: Session, user_id: uuid.UUID, organization_id: uuid.UUID) -> bool:
    row = db.scalar(
        select(OrganizationMember.id).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
        )
    )
    return row is not None


def approve_authorization_request(
    db: Session,
    *,
    request_id: uuid.UUID,
    user_id: uuid.UUID,
) -> str:
    """Return redirect_uri with code (+ state)."""
    req = get_authorization_request(db, request_id)
    if req is None:
        raise LookupError("expired_request")

    app = get_active_app(db, req.client_id)
    if app is None:
        raise LookupError("invalid_client")
    if not user_is_org_member(db, user_id, app.organization_id):
        raise PermissionError("not_org_member")

    raw_code = generate_token()
    code_record = IntegrationOAuthAuthCode(
        code_hash=hash_token(raw_code),
        client_id=req.client_id,
        user_id=user_id,
        redirect_uri=req.redirect_uri,
        scopes=list(req.scopes),
        expires_at=_now() + timedelta(minutes=AUTH_CODE_TTL_MINUTES),
    )
    db.add(code_record)
    db.delete(req)
    db.flush()

    params: dict[str, str] = {"code": raw_code}
    if req.state:
        params["state"] = req.state
    return f"{req.redirect_uri}?{urlencode(params)}"


def exchange_authorization_code(
    db: Session,
    *,
    client_id: str,
    client_secret: str,
    code: str,
) -> tuple[str, list[str]]:
    """ClickUp-shaped token exchange. Returns (access_token, scopes)."""
    from app.services import api_token_service

    app = get_active_app(db, client_id)
    if app is None:
        raise LookupError("invalid_client")
    if not verify_client_secret(app, client_secret):
        raise LookupError("invalid_client")

    code_hash = hash_token(code)
    record = db.scalar(
        select(IntegrationOAuthAuthCode).where(IntegrationOAuthAuthCode.code_hash == code_hash)
    )
    if record is None or record.used_at is not None or record.expires_at <= _now():
        raise LookupError("invalid_grant")
    if record.client_id != client_id:
        raise LookupError("invalid_grant")

    record.used_at = _now()
    scopes = list(record.scopes)
    if not scopes:
        raise LookupError("invalid_scope")

    raw_pat, pat = api_token_service.create_pat(
        db,
        user_id=record.user_id,
        name=f"OAuth: {app.name}",
        scopes=scopes,
        expires_in_days=None,  # ClickUp-style non-expiring access token
        audit=True,
    )
    record.pat_id = pat.id
    db.flush()
    return raw_pat, list(pat.scopes)


def _workspace_count_for_user_in_org(
    db: Session, user_id: uuid.UUID, organization_id: uuid.UUID
) -> int:
    from sqlalchemy import func

    n = db.scalar(
        select(func.count())
        .select_from(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.organization_id == organization_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    return int(n or 0) or 1


def list_user_authorized_apps(db: Session, user_id: uuid.UUID) -> list[dict]:
    """Apps the user has connected via OAuth (active PAT issued from an auth code)."""
    rows = db.execute(
        select(IntegrationOAuthAuthCode, IntegrationOAuthApp, PersonalAccessToken)
        .join(
            IntegrationOAuthApp,
            IntegrationOAuthApp.client_id == IntegrationOAuthAuthCode.client_id,
        )
        .join(
            PersonalAccessToken,
            PersonalAccessToken.id == IntegrationOAuthAuthCode.pat_id,
        )
        .where(
            IntegrationOAuthAuthCode.user_id == user_id,
            IntegrationOAuthAuthCode.pat_id.is_not(None),
            PersonalAccessToken.user_id == user_id,
            PersonalAccessToken.revoked_at.is_(None),
        )
        .order_by(PersonalAccessToken.created_at.desc())
    ).all()

    seen_apps: set[uuid.UUID] = set()
    out: list[dict] = []
    for code, app, pat in rows:
        if app.id in seen_apps:
            continue
        seen_apps.add(app.id)
        out.append(
            {
                "app_id": app.id,
                "name": app.name,
                "client_id": app.client_id,
                "organization_id": app.organization_id,
                "workspace_count": _workspace_count_for_user_in_org(
                    db, user_id, app.organization_id
                ),
                "authorized_at": pat.created_at,
                "scopes": list(pat.scopes),
                "pat_id": pat.id,
            }
        )
    return out


def unauthorize_user_app(db: Session, user_id: uuid.UUID, app_id: uuid.UUID) -> int:
    """Revoke all active OAuth PATs for this user tied to the given app. Returns count revoked."""
    from app.services import api_token_service

    app = db.get(IntegrationOAuthApp, app_id)
    if app is None:
        raise LookupError("app_not_found")

    pats = list(
        db.scalars(
            select(PersonalAccessToken)
            .join(
                IntegrationOAuthAuthCode,
                IntegrationOAuthAuthCode.pat_id == PersonalAccessToken.id,
            )
            .where(
                IntegrationOAuthAuthCode.user_id == user_id,
                IntegrationOAuthAuthCode.client_id == app.client_id,
                PersonalAccessToken.user_id == user_id,
                PersonalAccessToken.revoked_at.is_(None),
            )
        ).all()
    )
    if not pats:
        raise LookupError("authorization_not_found")

    for pat in pats:
        api_token_service.revoke_token(
            db, user_id, pat.id, reason="oauth_unauthorized"
        )
    db.flush()
    return len(pats)
