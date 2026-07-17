import base64
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

import jwt
from cryptography.fernet import Fernet

from app.core.config import settings


# --- Opaque tokens (refresh / invite / legacy PAT lookup) ---
# Raw token goes to the user; only its SHA-256 hash is stored.
# PAT secrets use app.core.api_key_digest (HMAC pepper for v1) — not password KDFs.
# Passwords are low-entropy and need Argon2/bcrypt; PAT material is high-entropy random.

def generate_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# --- JWT access tokens ---

def _jwt_decode_options() -> dict[str, Any]:
    return {
        "verify_aud": True,
        "verify_iss": True,
    }


def create_access_token(user_id: uuid.UUID, is_superadmin: bool = False) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "type": "access",
        "sa": is_superadmin,
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "jti": secrets.token_hex(16),
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            audience=settings.JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
            options=_jwt_decode_options(),
        )
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return payload


# --- 2FA challenge token (short-lived; only authorizes the /auth/2fa/* step) ---

def create_2fa_challenge_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "type": "2fa_challenge",
        "iat": now,
        "exp": now + timedelta(minutes=settings.TWO_FACTOR_CHALLENGE_EXPIRE_MINUTES),
        "jti": secrets.token_hex(16),
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_2fa_challenge_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            audience=settings.JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
            options=_jwt_decode_options(),
        )
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "2fa_challenge":
        return None
    try:
        return uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        return None


# --- TOTP secret encryption at rest (Fernet, key derived from SECRET_KEY) ---
# Rotating SECRET_KEY invalidates stored TOTP secrets (users must re-enroll).

@lru_cache
def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_secret(enc: str) -> str:
    return _fernet().decrypt(enc.encode("utf-8")).decode("utf-8")


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)


def invite_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=settings.INVITE_TOKEN_EXPIRE_HOURS)
