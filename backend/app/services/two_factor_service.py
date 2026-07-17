"""TOTP two-factor authentication: enrollment, verification, recovery codes.

Applies to the email one-time-code login path only — SSO logins rely on the
identity provider's own MFA. Org owners can require 2FA for their org's members
(see Organization.require_2fa).
"""
import secrets
from datetime import datetime, timezone

import pyotp
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decrypt_secret, encrypt_secret, hash_token
from app.models.organization import Organization, OrganizationMember
from app.models.user import TwoFactorRecoveryCode, User


class TwoFactorError(HTTPException):
    def __init__(self, detail: str, status_code: int = 400):
        super().__init__(status_code=status_code, detail=detail)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def org_requires_2fa(db: Session, user: User) -> bool:
    """True if any active organization the user belongs to requires 2FA."""
    return bool(
        db.scalar(
            select(OrganizationMember.id)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user.id,
                Organization.require_2fa.is_(True),
                Organization.deleted_at.is_(None),
                Organization.is_disabled.is_(False),
            )
            .limit(1)
        )
    )


def start_enrollment(db: Session, user: User) -> tuple[str, str]:
    """Generate a fresh TOTP secret (stored encrypted, pending — NOT yet enabled)
    and return (secret, otpauth_uri) for QR display."""
    secret = pyotp.random_base32()
    user.totp_secret_enc = encrypt_secret(secret)
    user.totp_enabled = False
    user.totp_confirmed_at = None
    db.flush()
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=user.email, issuer_name=settings.TWO_FACTOR_ISSUER
    )
    return secret, uri


def _issue_recovery_codes(db: Session, user: User) -> list[str]:
    """Replace any existing recovery codes with a fresh set; return them once."""
    db.execute(delete(TwoFactorRecoveryCode).where(TwoFactorRecoveryCode.user_id == user.id))
    codes: list[str] = []
    for _ in range(settings.RECOVERY_CODE_COUNT):
        raw = f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}"
        codes.append(raw)
        db.add(TwoFactorRecoveryCode(user_id=user.id, code_hash=hash_token(raw)))
    db.flush()
    return codes


def confirm_enrollment(db: Session, user: User, code: str) -> list[str]:
    """Verify the first TOTP code against the pending secret; on success enable
    2FA and return a fresh set of one-time recovery codes (shown to the user once)."""
    if not user.totp_secret_enc:
        raise TwoFactorError("Start two-factor setup first.")
    secret = decrypt_secret(user.totp_secret_enc)
    if not pyotp.TOTP(secret).verify((code or "").strip(), valid_window=1):
        raise TwoFactorError("That code is incorrect. Check your authenticator and try again.")
    user.totp_enabled = True
    user.totp_confirmed_at = _now()
    codes = _issue_recovery_codes(db, user)
    return codes


def verify_code(db: Session, user: User, code: str) -> bool:
    """True if `code` is a valid current TOTP, OR an unused recovery code (which is
    then consumed). Used to complete an enrolled user's login."""
    code = (code or "").strip()
    if not user.totp_enabled or not user.totp_secret_enc or not code:
        return False
    secret = decrypt_secret(user.totp_secret_enc)
    if pyotp.TOTP(secret).verify(code, valid_window=1):
        return True
    rec = db.scalar(
        select(TwoFactorRecoveryCode).where(
            TwoFactorRecoveryCode.user_id == user.id,
            TwoFactorRecoveryCode.code_hash == hash_token(code),
            TwoFactorRecoveryCode.used_at.is_(None),
        )
    )
    if rec:
        rec.used_at = _now()
        db.flush()
        return True
    return False


def disable(db: Session, user: User) -> None:
    """Turn off 2FA and wipe the secret + recovery codes. Blocked while any of the
    user's orgs requires 2FA."""
    if org_requires_2fa(db, user):
        raise TwoFactorError(
            "Your organization requires two-factor authentication, so it can't be disabled.",
            status_code=409,
        )
    user.totp_secret_enc = None
    user.totp_enabled = False
    user.totp_confirmed_at = None
    db.execute(delete(TwoFactorRecoveryCode).where(TwoFactorRecoveryCode.user_id == user.id))
    db.flush()


def recovery_codes_remaining(db: Session, user: User) -> int:
    return db.scalar(
        select(func.count(TwoFactorRecoveryCode.id)).where(
            TwoFactorRecoveryCode.user_id == user.id,
            TwoFactorRecoveryCode.used_at.is_(None),
        )
    ) or 0
