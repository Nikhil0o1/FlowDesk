"""Personal access token lifecycle for MCP / automation."""

from __future__ import annotations

import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.api_key_digest import (
    digest_legacy_full_token,
    digest_v1_secret,
    get_current_pepper_version,
    resolve_pepper,
)
from app.core.api_token_scopes import normalize_scopes
from app.core.config import settings
from app.core.pat_audit import audit_pat_created, audit_pat_revoked, audit_pat_rotated, record_denial_aggregate
from app.models.api_token import PAT_LIVE_PREFIX, PAT_PREFIX, PersonalAccessToken

MAX_TOKENS_PER_USER = 25
HASH_VERSION_LEGACY = 0
HASH_VERSION_V1 = 1


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_public_key_id() -> str:
    # Alphabet without underscore — token format is fd_live_<kid>_<secret>.
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(12))


def _placeholder_token_hash() -> str:
    """Unique non-null token_hash for v1 rows (legacy unique index)."""
    return digest_legacy_full_token(f"v1-placeholder-{uuid.uuid4()}")


def is_pat_shaped(raw: str) -> bool:
    return raw.startswith(PAT_PREFIX) or raw.startswith(PAT_LIVE_PREFIX)


def _parse_live_token(raw: str) -> tuple[str, str] | None:
    if not raw.startswith(PAT_LIVE_PREFIX):
        return None
    rest = raw[len(PAT_LIVE_PREFIX) :]
    parts = rest.split("_", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]


def _is_inactive(record: PersonalAccessToken, now: datetime) -> bool:
    if record.revoked_at is not None:
        return True
    if record.revoke_at is not None and record.revoke_at <= now:
        return True
    if record.expires_at is not None and record.expires_at <= now:
        return True
    return False


def create_pat(
    db: Session,
    *,
    user_id: uuid.UUID,
    name: str,
    scopes: list[str] | None = None,
    expires_in_days: int | None = 90,
    rotated_from_id: uuid.UUID | None = None,
    expires_at: datetime | None = None,
    ip_address: str | None = None,
    audit: bool = True,
) -> tuple[str, PersonalAccessToken]:
    rows = db.scalars(
        select(PersonalAccessToken.id).where(
            PersonalAccessToken.user_id == user_id,
            PersonalAccessToken.revoked_at.is_(None),
        )
    ).all()
    if len(rows) >= MAX_TOKENS_PER_USER:
        raise ValueError(f"Maximum of {MAX_TOKENS_PER_USER} active tokens per user")

    normalized = normalize_scopes(scopes)
    pepper_version = get_current_pepper_version()
    pepper = resolve_pepper(pepper_version)
    if pepper is None:
        # Dev convenience: empty pepper map uses a deterministic local pepper for version 1
        if not settings.is_production and not settings.API_KEY_PEPPERS.strip():
            pepper = b"dev-only-pat-pepper"
            pepper_version = 1
        else:
            raise ValueError("API_KEY_PEPPER_CURRENT has no matching entry in API_KEY_PEPPERS")

    public_key_id = _new_public_key_id()
    secret = secrets.token_urlsafe(32)
    raw = f"{PAT_LIVE_PREFIX}{public_key_id}_{secret}"
    secret_digest = digest_v1_secret(secret, pepper)

    if expires_at is None and expires_in_days is not None:
        expires_at = _now() + timedelta(days=expires_in_days)

    record = PersonalAccessToken(
        user_id=user_id,
        name=name.strip(),
        token_hash=_placeholder_token_hash(),
        token_prefix=f"{PAT_LIVE_PREFIX}{public_key_id}"[:16],
        scopes=normalized,
        expires_at=expires_at,
        public_key_id=public_key_id,
        secret_digest=secret_digest,
        display_suffix=secret[-4:],
        hash_version=HASH_VERSION_V1,
        pepper_version=pepper_version,
        environment="live",
        rotated_from_id=rotated_from_id,
    )
    db.add(record)
    db.flush()
    if audit:
        audit_pat_created(
            db,
            actor_id=user_id,
            token_id=record.id,
            scopes=normalized,
            ip_address=ip_address,
        )
    return raw, record


def _verify_legacy(db: Session, raw: str) -> PersonalAccessToken | None:
    token_hash = digest_legacy_full_token(raw)
    record = db.scalar(
        select(PersonalAccessToken).where(PersonalAccessToken.token_hash == token_hash)
    )
    return record


def _verify_v1(db: Session, raw: str) -> PersonalAccessToken | None:
    parsed = _parse_live_token(raw)
    if parsed is None:
        return None
    public_key_id, secret = parsed
    record = db.scalar(
        select(PersonalAccessToken).where(PersonalAccessToken.public_key_id == public_key_id)
    )
    if record is None or record.secret_digest is None or record.pepper_version is None:
        # Constant-time-ish pad: run a dummy HMAC
        digest_v1_secret(secret, b"pad-pepper-missing-record")
        return None
    pepper = resolve_pepper(record.pepper_version)
    if pepper is None and not settings.is_production and not settings.API_KEY_PEPPERS.strip():
        pepper = b"dev-only-pat-pepper"
    if pepper is None:
        digest_v1_secret(secret, b"pad-pepper-unavailable")
        return None
    candidate = digest_v1_secret(secret, pepper)
    if not hmac.compare_digest(candidate, record.secret_digest):
        return None
    return record


def verify_pat(db: Session, raw: str) -> PersonalAccessToken | None:
    """Return active PAT or None. Callers must treat all Nones as identical 401."""
    now = _now()
    record: PersonalAccessToken | None = None

    if raw.startswith(PAT_LIVE_PREFIX):
        record = _verify_v1(db, raw)
    elif raw.startswith(PAT_PREFIX):
        record = _verify_legacy(db, raw)
    else:
        return None

    if record is None:
        return None

    if _is_inactive(record, now):
        if record.expires_at is not None and record.expires_at <= now:
            record_denial_aggregate(
                event="pat.expired_attempt",
                token_id=record.id,
                route="auth",
            )
        elif record.revoked_at is not None or (
            record.revoke_at is not None and record.revoke_at <= now
        ):
            record_denial_aggregate(
                event="pat.revoked_attempt",
                token_id=record.id,
                route="auth",
            )
        return None

    return record


def maybe_migrate_pepper(db: Session, record: PersonalAccessToken, raw: str) -> None:
    """Online rehash to current pepper while raw secret is available (v1 only)."""
    if record.hash_version != HASH_VERSION_V1:
        return
    current = get_current_pepper_version()
    if record.pepper_version is None or record.pepper_version >= current:
        return
    parsed = _parse_live_token(raw)
    if parsed is None:
        return
    _, secret = parsed
    pepper = resolve_pepper(current)
    if pepper is None:
        return
    record.secret_digest = digest_v1_secret(secret, pepper)
    record.pepper_version = current


def touch_last_used(db: Session, record: PersonalAccessToken) -> None:
    record.last_used_at = _now()


def list_user_tokens(db: Session, user_id: uuid.UUID) -> list[PersonalAccessToken]:
    return list(
        db.scalars(
            select(PersonalAccessToken)
            .where(PersonalAccessToken.user_id == user_id)
            .order_by(PersonalAccessToken.created_at.desc())
        ).all()
    )


def revoke_token(
    db: Session,
    user_id: uuid.UUID,
    token_id: uuid.UUID,
    *,
    ip_address: str | None = None,
    reason: str = "immediate",
) -> PersonalAccessToken:
    record = db.get(PersonalAccessToken, token_id)
    if not record or record.user_id != user_id:
        raise LookupError("Token not found")
    if record.revoked_at is None:
        record.revoked_at = _now()
        record.revoke_at = None
        audit_pat_revoked(
            db,
            actor_id=user_id,
            token_id=record.id,
            reason=reason,
            ip_address=ip_address,
        )
    return record


def rotate_token(
    db: Session,
    user_id: uuid.UUID,
    token_id: uuid.UUID,
    *,
    scopes: list[str] | None = None,
    ip_address: str | None = None,
) -> tuple[str, PersonalAccessToken]:
    old = db.get(PersonalAccessToken, token_id)
    if not old or old.user_id != user_id:
        raise LookupError("Token not found")
    if old.revoked_at is not None:
        raise ValueError("Token is already revoked")

    now = _now()
    max_cap = now + timedelta(days=settings.PAT_MAX_LIFETIME_DAYS)
    if old.expires_at is not None:
        new_expires = min(old.expires_at, max_cap)
    else:
        new_expires = max_cap

    new_scopes = normalize_scopes(scopes) if scopes is not None else list(old.scopes)
    raw, new_record = create_pat(
        db,
        user_id=user_id,
        name=old.name,
        scopes=new_scopes,
        expires_at=new_expires,
        expires_in_days=None,
        rotated_from_id=old.id,
        ip_address=ip_address,
        audit=False,
    )
    grace = timedelta(seconds=settings.PAT_ROTATION_GRACE_SECONDS)
    old.revoke_at = now + grace
    audit_pat_rotated(
        db,
        actor_id=user_id,
        new_token_id=new_record.id,
        old_token_id=old.id,
        scopes=new_scopes,
        ip_address=ip_address,
    )
    return raw, new_record


def apply_due_revocations(db: Session) -> int:
    """Stamp revoked_at for tokens whose revoke_at has passed. Returns count."""
    now = _now()
    rows = list(
        db.scalars(
            select(PersonalAccessToken).where(
                PersonalAccessToken.revoke_at.is_not(None),
                PersonalAccessToken.revoke_at <= now,
                PersonalAccessToken.revoked_at.is_(None),
            )
        ).all()
    )
    for record in rows:
        record.revoked_at = now
        audit_pat_revoked(
            db,
            actor_id=None,
            token_id=record.id,
            reason="delayed_rotation",
        )
    return len(rows)


def cleanup_expired_pats(db: Session) -> int:
    """Optionally mark long-expired tokens revoked for hygiene. Returns count."""
    now = _now()
    rows = list(
        db.scalars(
            select(PersonalAccessToken).where(
                PersonalAccessToken.expires_at.is_not(None),
                PersonalAccessToken.expires_at <= now,
                PersonalAccessToken.revoked_at.is_(None),
            )
        ).all()
    )
    for record in rows:
        record.revoked_at = now
        record.revoke_at = None
        audit_pat_revoked(
            db,
            actor_id=None,
            token_id=record.id,
            reason="expired_cleanup",
        )
    return len(rows)


def rename_token(
    db: Session,
    user_id: uuid.UUID,
    token_id: uuid.UUID,
    *,
    name: str,
) -> PersonalAccessToken:
    record = db.get(PersonalAccessToken, token_id)
    if not record or record.user_id != user_id:
        raise LookupError("Token not found")
    if record.revoked_at is not None:
        raise ValueError("Cannot rename a revoked token")
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Name is required")
    if len(cleaned) > 120:
        raise ValueError("Name must be at most 120 characters")
    record.name = cleaned
    return record


def get_user_token(
    db: Session, user_id: uuid.UUID, token_id: uuid.UUID
) -> PersonalAccessToken:
    record = db.get(PersonalAccessToken, token_id)
    if not record or record.user_id != user_id:
        raise LookupError("Token not found")
    return record


def pepper_migration_report(db: Session) -> dict[str, int]:
    current = get_current_pepper_version()
    rows = db.scalars(
        select(PersonalAccessToken).where(
            PersonalAccessToken.revoked_at.is_(None),
            PersonalAccessToken.hash_version == HASH_VERSION_V1,
        )
    ).all()
    counts: dict[str, int] = {"current_version": current}
    for r in rows:
        v = r.pepper_version if r.pepper_version is not None else -1
        key = f"pepper_{v}"
        counts[key] = counts.get(key, 0) + 1
    return counts
