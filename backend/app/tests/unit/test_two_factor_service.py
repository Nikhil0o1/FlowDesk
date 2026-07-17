"""Phase 2 unit tests — two_factor_service enrollment and verification."""
import pyotp
import pytest

from app.models.organization import OrganizationMember
from app.services.two_factor_service import (
    TwoFactorError,
    confirm_enrollment,
    disable,
    org_requires_2fa,
    recovery_codes_remaining,
    start_enrollment,
    verify_code,
)
from app.core.security import decrypt_secret


@pytest.mark.unit
def test_start_enrollment_returns_secret_and_uri(db, owner):
    secret, uri = start_enrollment(db, owner)
    assert len(secret) >= 16
    assert "otpauth://" in uri
    assert owner.totp_enabled is False
    assert decrypt_secret(owner.totp_secret_enc) == secret


@pytest.mark.unit
def test_confirm_enrollment_with_valid_code(db, owner):
    secret, _ = start_enrollment(db, owner)
    code = pyotp.TOTP(secret).now()
    codes = confirm_enrollment(db, owner, code)
    assert owner.totp_enabled is True
    assert len(codes) >= 8
    assert recovery_codes_remaining(db, owner) == len(codes)


@pytest.mark.unit
def test_confirm_enrollment_rejects_wrong_code(db, owner):
    start_enrollment(db, owner)
    with pytest.raises(TwoFactorError):
        confirm_enrollment(db, owner, "000000")


@pytest.mark.unit
def test_verify_code_accepts_totp(db, owner):
    secret, _ = start_enrollment(db, owner)
    confirm_enrollment(db, owner, pyotp.TOTP(secret).now())
    assert verify_code(db, owner, pyotp.TOTP(secret).now()) is True


@pytest.mark.unit
def test_verify_code_consumes_recovery_code(db, owner):
    secret, _ = start_enrollment(db, owner)
    codes = confirm_enrollment(db, owner, pyotp.TOTP(secret).now())
    backup = codes[0]
    assert verify_code(db, owner, backup) is True
    assert verify_code(db, owner, backup) is False


@pytest.mark.unit
def test_disable_blocked_when_org_requires_2fa(db, org, owner):
    secret, _ = start_enrollment(db, owner)
    confirm_enrollment(db, owner, pyotp.TOTP(secret).now())
    org.require_2fa = True
    db.flush()
    assert org_requires_2fa(db, owner) is True
    with pytest.raises(TwoFactorError) as exc:
        disable(db, owner)
    assert exc.value.status_code == 409


@pytest.mark.unit
def test_disable_clears_secrets(db, owner):
    secret, _ = start_enrollment(db, owner)
    confirm_enrollment(db, owner, pyotp.TOTP(secret).now())
    disable(db, owner)
    assert owner.totp_enabled is False
    assert owner.totp_secret_enc is None
    assert recovery_codes_remaining(db, owner) == 0
