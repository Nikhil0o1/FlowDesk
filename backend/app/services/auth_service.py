import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    create_access_token,
    generate_token,
    hash_password,
    hash_token,
    password_reset_token_expiry,
    refresh_token_expiry,
    verify_password,
)
from app.models.user import PasswordResetToken, RefreshToken, User
from app.services import email_service
from app.services.audit_service import audit


class AuthError(HTTPException):
    def __init__(self, detail: str = "Invalid email or password"):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.lower().strip()))
    if not user or user.deleted_at is not None:
        raise AuthError()
    if not verify_password(password, user.hashed_password):
        audit(db, "auth.login_failed", actor_id=user.id, data={"email": email})
        db.commit()
        raise AuthError()
    if not user.is_active:
        raise AuthError("This account has been deactivated")
    return user


def login_with_google(db: Session, token: str) -> User:
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google SSO is not configured")
    try:
        info = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), settings.GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise AuthError("Google sign-in could not be verified")

    email = (info.get("email") or "").lower().strip()
    if not email or not info.get("email_verified", False):
        raise AuthError("Google account email is not verified")

    user = db.scalar(select(User).where(User.email == email))
    if not user or user.deleted_at is not None:
        # B2B: no public signup — Google login only works for invited/activated accounts
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No account exists for this Google email. Ask your organization admin for an invitation.",
        )
    if not user.is_active:
        raise AuthError("This account has been deactivated")

    if not user.google_sub:
        user.google_sub = info.get("sub")
    if user.profile and not user.profile.avatar_url and info.get("picture"):
        user.profile.avatar_url = info["picture"]
    return user


def issue_tokens(
    db: Session,
    user: User,
    user_agent: str | None = None,
    ip_address: str | None = None,
    family_id: uuid.UUID | None = None,
) -> tuple[str, str]:
    """Return (access_token, raw_refresh_token). Stores only the refresh hash."""
    raw_refresh = generate_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            family_id=family_id or uuid.uuid4(),
            expires_at=refresh_token_expiry(),
            user_agent=(user_agent or "")[:400] or None,
            ip_address=ip_address,
        )
    )
    user.last_login_at = _now()
    access = create_access_token(user.id, user.is_platform_superadmin)
    return access, raw_refresh


def rotate_refresh_token(
    db: Session, raw_token: str, user_agent: str | None = None, ip_address: str | None = None
) -> tuple[str, str, User]:
    """Validate + rotate a refresh token. Detects reuse and revokes the family."""
    token_hash = hash_token(raw_token)
    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if not record:
        raise AuthError("Invalid session")

    if record.revoked_at is not None:
        # Two tabs (or a retried request) can legitimately replay a token that
        # was rotated moments ago — that's a race, not an attack. Within a short
        # grace window, rotate again off the same family instead of logging the
        # user out everywhere.
        is_recent_race = (
            record.replaced_by_hash is not None
            and record.revoked_at > _now() - timedelta(seconds=30)
        )
        if not is_recent_race:
            # Genuine reuse of an old token: kill the whole family.
            db.execute(
                update(RefreshToken)
                .where(RefreshToken.family_id == record.family_id, RefreshToken.revoked_at.is_(None))
                .values(revoked_at=_now())
            )
            audit(db, "auth.refresh_token_reuse_detected", actor_id=record.user_id)
            db.commit()
            raise AuthError("Session expired, please sign in again")

    if record.expires_at <= _now():
        raise AuthError("Session expired, please sign in again")

    user = db.get(User, record.user_id)
    if not user or not user.is_active or user.deleted_at is not None:
        raise AuthError("This account is no longer active")

    raw_new = generate_token()
    record.revoked_at = _now()
    record.replaced_by_hash = hash_token(raw_new)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_new),
            family_id=record.family_id,
            expires_at=refresh_token_expiry(),
            user_agent=(user_agent or "")[:400] or None,
            ip_address=ip_address,
        )
    )
    access = create_access_token(user.id, user.is_platform_superadmin)
    return access, raw_new, user


def revoke_refresh_token(db: Session, raw_token: str) -> None:
    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token)))
    if record and record.revoked_at is None:
        record.revoked_at = _now()


def revoke_all_user_tokens(db: Session, user_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def request_password_reset(db: Session, email: str) -> None:
    """Always succeeds from the caller's perspective (no account enumeration)."""
    user = db.scalar(select(User).where(User.email == email.lower().strip()))
    if not user or not user.is_active or user.deleted_at is not None:
        return
    raw = generate_token()
    db.add(
        PasswordResetToken(
            user_id=user.id, token_hash=hash_token(raw), expires_at=password_reset_token_expiry()
        )
    )
    audit(db, "auth.password_reset_requested", actor_id=user.id)
    db.commit()
    email_service.send_password_reset_email(user.email, raw)


def reset_password(db: Session, raw_token: str, new_password: str) -> User:
    record = db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw_token))
    )
    if not record or record.used_at is not None or record.expires_at <= _now():
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")
    user = db.get(User, record.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired")
    user.hashed_password = hash_password(new_password)
    record.used_at = _now()
    revoke_all_user_tokens(db, user.id)
    audit(db, "auth.password_reset_completed", actor_id=user.id)
    db.commit()
    return user
