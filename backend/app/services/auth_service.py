import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

import jwt
from fastapi import HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jwt import PyJWKClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_token,
    hash_token,
    refresh_token_expiry,
)
from app.models.user import LoginOtp, RefreshToken, RevokedAccessToken, User
from app.services import email_service
from app.services.audit_service import audit
from app.services.login_access_service import (
    LOGIN_PERMISSION_MESSAGE,
    LoginContext,
    assert_can_login,
    has_pending_invite,
)
from app.services.login_lockout_service import assert_not_locked, clear_lockout, record_failed_attempt


class AuthError(HTTPException):
    def __init__(self, detail: str = "Invalid email or password"):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _verify_google_id_token(token: str) -> dict:
    """Validate a Google Identity Services id_token for our OAuth client."""
    client_id = settings.GOOGLE_CLIENT_ID.strip()
    request = google_requests.Request()
    try:
        return google_id_token.verify_oauth2_token(
            token,
            request,
            audience=client_id,
            clock_skew_in_seconds=60,
        )
    except ValueError as first_exc:
        # FedCM / some GIS flows may surface the web client in azp; verify signature
        # first, then enforce aud/azp manually.
        try:
            idinfo = google_id_token.verify_oauth2_token(
                token,
                request,
                audience=None,
                clock_skew_in_seconds=60,
            )
        except ValueError:
            if settings.DEBUG:
                logger.debug("Google id_token verification failed: %s", first_exc)
            raise AuthError("Google sign-in could not be verified") from first_exc

        aud = idinfo.get("aud")
        azp = idinfo.get("azp")
        allowed = {client_id}
        if isinstance(aud, str):
            allowed.add(aud)
        elif isinstance(aud, (list, tuple)):
            allowed.update(str(a) for a in aud)
        if client_id not in allowed and azp != client_id:
            if settings.DEBUG:
                logger.debug(
                    "Google id_token audience mismatch aud=%r azp=%r expected=%r",
                    aud,
                    azp,
                    client_id,
                )
            raise AuthError("Google sign-in could not be verified")
        return idinfo


def login_with_google(db: Session, token: str) -> tuple[User, LoginContext]:
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google SSO is not configured")
    if not (token or "").strip():
        raise AuthError("Google sign-in could not be verified")

    info = _verify_google_id_token(token.strip())

    email = (info.get("email") or "").lower().strip()
    if not email or not info.get("email_verified", False):
        raise AuthError("Google account email is not verified")

    user = db.scalar(select(User).where(User.email == email))
    if not user or user.deleted_at is not None:
        if has_pending_invite(db, email):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "You have a pending invitation. Open the invite link from your email "
                    "to activate your account, then sign in with Google."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=LOGIN_PERMISSION_MESSAGE,
        )
    if not user.is_active:
        raise AuthError("This account has been deactivated")

    if not user.google_sub:
        user.google_sub = info.get("sub")
    if user.profile and not user.profile.avatar_url and info.get("picture"):
        user.profile.avatar_url = info["picture"]
    login_ctx = assert_can_login(db, user)
    return user, login_ctx


# Cache the JWKS client per tenant — it fetches & caches Microsoft's signing keys.
_ms_jwks_clients: dict[str, PyJWKClient] = {}


def _microsoft_jwks_client(tenant: str) -> PyJWKClient:
    client = _ms_jwks_clients.get(tenant)
    if client is None:
        client = PyJWKClient(f"https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys")
        _ms_jwks_clients[tenant] = client
    return client


# Personal Microsoft account tenant id (reject when MICROSOFT_TENANT=organizations)
_MS_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36ad98066b74"


def _microsoft_allowed_tenant(tid: str) -> bool:
    configured = (settings.MICROSOFT_TENANT or "organizations").strip().lower()
    if configured in ("common", ""):
        return True
    if configured == "organizations":
        return tid != _MS_CONSUMER_TENANT
    if configured == "consumers":
        return tid == _MS_CONSUMER_TENANT
    return tid == configured


def login_with_microsoft(db: Session, token: str) -> tuple[User, LoginContext]:
    """Verify a Microsoft (Entra ID) v2.0 ID token and log the matching user in."""
    if not settings.MICROSOFT_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Microsoft SSO is not configured")
    tenant = settings.MICROSOFT_TENANT or "organizations"
    try:
        signing_key = _microsoft_jwks_client(tenant).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.MICROSOFT_CLIENT_ID,
            options={"verify_iss": False},
        )
    except Exception:
        raise AuthError("Microsoft sign-in could not be verified")

    tid = claims.get("tid")
    iss = claims.get("iss")
    if not tid or not iss:
        raise AuthError("Microsoft sign-in could not be verified")
    expected_iss = f"https://login.microsoftonline.com/{tid}/v2.0"
    if iss != expected_iss:
        raise AuthError("Microsoft sign-in could not be verified")
    if not _microsoft_allowed_tenant(tid):
        raise AuthError("Microsoft sign-in is not allowed for this organization")

    if claims.get("email_verified") is False:
        raise AuthError("Microsoft account email is not verified")

    oid = claims.get("oid") or claims.get("sub")
    if not oid:
        raise AuthError("Microsoft sign-in could not be verified")

    user = db.scalar(select(User).where(User.microsoft_sub == oid))
    if not user:
        email = (
            claims.get("email")
            or claims.get("preferred_username")
            or claims.get("upn")
            or ""
        ).lower().strip()
        if not email or "@" not in email:
            raise AuthError("Microsoft account has no usable email")
        user = db.scalar(select(User).where(User.email == email))
        if user and user.microsoft_sub and user.microsoft_sub != oid:
            raise AuthError("Microsoft account does not match this user")
        if user and not user.microsoft_sub:
            user.microsoft_sub = oid
    elif user.microsoft_sub != oid:
        raise AuthError("Microsoft account does not match this user")

    if not user or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to sign in. Access is by invitation only — ask your organization admin for an invite.",
        )
    if not user.is_active:
        raise AuthError("This account has been deactivated")

    login_ctx = assert_can_login(db, user)
    return user, login_ctx


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
) -> tuple[str, str, User, LoginContext]:
    """Validate + rotate a refresh token. Detects reuse and revokes the family."""
    token_hash = hash_token(raw_token)
    record = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash).with_for_update()
    )
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

    login_ctx = assert_can_login(db, user)

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
    return access, raw_new, user, login_ctx


def establish_session_from_refresh(db: Session, raw_token: str) -> tuple[str, User, LoginContext]:
    """Validate a refresh token and issue an access token without rotation.

    Used after OAuth redirect so a second /auth/refresh call cannot revoke the
    cookie before the browser stores the rotated value (cross-site Set-Cookie)."""
    token_hash = hash_token(raw_token)
    record = db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
        )
    )
    if not record:
        raise AuthError("Invalid session")
    if record.expires_at <= _now():
        raise AuthError("Session expired, please sign in again")

    user = db.get(User, record.user_id)
    if not user or not user.is_active or user.deleted_at is not None:
        raise AuthError("This account is no longer active")

    login_ctx = assert_can_login(db, user)
    access = create_access_token(user.id, user.is_platform_superadmin)
    return access, user, login_ctx


def revoke_refresh_token(db: Session, raw_token: str) -> None:
    record = db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(raw_token))
        .with_for_update()
    )
    if record and record.revoked_at is None:
        record.revoked_at = _now()


def revoke_access_token_from_raw(db: Session, raw_access_token: str) -> None:
    """Blocklist the jti of a bearer access token (e.g. on logout)."""
    payload = decode_access_token(raw_access_token)
    if not payload:
        return
    jti = payload.get("jti")
    if not jti:
        return
    try:
        user_id = uuid.UUID(payload["sub"])
        expires_at = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
    except (KeyError, ValueError, TypeError, OSError):
        return
    if db.scalar(select(RevokedAccessToken.id).where(RevokedAccessToken.jti == jti)):
        return
    db.add(
        RevokedAccessToken(
            jti=jti,
            user_id=user_id,
            expires_at=expires_at,
            revoked_at=_now(),
        )
    )


def is_access_token_revoked(db: Session, jti: str | None) -> bool:
    if not jti:
        return False
    return (
        db.scalar(select(RevokedAccessToken.id).where(RevokedAccessToken.jti == jti)) is not None
    )


def revoke_all_user_tokens(db: Session, user_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


# --------------------------------------------------------------------------
# Passwordless email one-time-code (OTP) sign-in
# --------------------------------------------------------------------------

def _otp_expiry() -> datetime:
    return _now() + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)


def request_login_otp(db: Session, email: str) -> None:
    """Email a one-time sign-in code — but only to an existing, active, invited
    account. Returns silently regardless so callers can't enumerate accounts."""
    email = email.lower().strip()
    user = db.scalar(select(User).where(User.email == email))
    if not user or not user.is_active or user.deleted_at is not None:
        return
    # Invalidate any earlier unused codes for this email (single active code).
    db.execute(
        update(LoginOtp)
        .where(LoginOtp.email == email, LoginOtp.consumed_at.is_(None))
        .values(consumed_at=_now())
    )
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(LoginOtp(email=email, code_hash=hash_token(code), expires_at=_otp_expiry()))
    audit(db, "auth.otp_requested", actor_id=user.id)
    db.commit()
    if not settings.is_production:
        logger.info("DEV OTP for %s: %s", email, code)
    email_service.send_login_otp_email(user.email, code, settings.OTP_EXPIRE_MINUTES)


def verify_login_otp(db: Session, email: str, code: str) -> tuple[User, LoginContext]:
    email = email.lower().strip()
    assert_not_locked(email)
    record = db.scalar(
        select(LoginOtp)
        .where(LoginOtp.email == email, LoginOtp.consumed_at.is_(None))
        .order_by(LoginOtp.created_at.desc())
        .with_for_update()
    )
    invalid = AuthError("That code is invalid or has expired. Request a new one.")
    if not record or record.expires_at <= _now():
        raise invalid
    if record.attempt_count >= settings.OTP_MAX_ATTEMPTS:
        db.execute(
            update(LoginOtp)
            .where(LoginOtp.id == record.id, LoginOtp.consumed_at.is_(None))
            .values(consumed_at=_now())
        )
        db.commit()
        raise AuthError("Too many attempts. Request a new code.")
    if not secrets.compare_digest(record.code_hash, hash_token((code or "").strip())):
        record.attempt_count += 1
        db.commit()
        record_failed_attempt(email)
        raise invalid

    clear_lockout(email)

    consumed = db.execute(
        update(LoginOtp)
        .where(LoginOtp.id == record.id, LoginOtp.consumed_at.is_(None))
        .values(consumed_at=_now())
    )
    if consumed.rowcount != 1:
        raise invalid

    user = db.scalar(select(User).where(User.email == email))
    if not user or not user.is_active or user.deleted_at is not None:
        db.commit()
        raise AuthError("This account is no longer active")
    login_ctx = assert_can_login(db, user)
    return user, login_ctx
