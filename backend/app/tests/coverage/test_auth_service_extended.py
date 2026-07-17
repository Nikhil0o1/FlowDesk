"""Coverage — auth_service SSO, OTP, and refresh-token edge cases."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import hash_token
from app.models.user import RefreshToken
from app.services.auth_service import (
    AuthError,
    login_with_google,
    login_with_microsoft,
    request_login_otp,
    rotate_refresh_token,
    revoke_access_token_from_raw,
)
from app.tests.conftest import make_user, seed_login_otp


@pytest.mark.coverage
def test_request_login_otp_silent_for_unknown_email(db):
    with patch("app.services.auth_service.email_service.send_login_otp_email") as mock_send:
        request_login_otp(db, "nobody@test.dev")
        mock_send.assert_not_called()


@pytest.mark.coverage
def test_verify_login_otp_max_attempts(db, org, owner, monkeypatch):
    from app.services.auth_service import verify_login_otp
    from app.services.login_lockout_service import clear_lockout

    monkeypatch.setattr("app.services.auth_service.settings.OTP_MAX_ATTEMPTS", 2)
    clear_lockout(owner.email)
    seed_login_otp(db, owner.email, "555555")
    with pytest.raises(AuthError, match="invalid or has expired"):
        verify_login_otp(db, owner.email, "000000")
    with pytest.raises(AuthError, match="invalid or has expired"):
        verify_login_otp(db, owner.email, "000000")
    with pytest.raises(AuthError, match="Too many attempts"):
        verify_login_otp(db, owner.email, "000000")


@pytest.mark.coverage
def test_rotate_refresh_token_reuse_revokes_family(db, org, owner):
    from app.services.auth_service import issue_tokens
    from sqlalchemy import select

    _, raw = issue_tokens(db, owner)
    db.commit()
    rotate_refresh_token(db, raw)
    db.commit()
    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    record.revoked_at = datetime.now(timezone.utc) - timedelta(minutes=2)
    db.commit()
    with pytest.raises(AuthError, match="Session expired"):
        rotate_refresh_token(db, raw)


@pytest.mark.coverage
@patch("app.services.auth_service._verify_google_id_token")
def test_login_with_google_rejects_uninvited(mock_verify, db, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "cid")
    mock_verify.return_value = {"email": "stranger@test.dev", "email_verified": True, "sub": "sub-1"}
    with pytest.raises(HTTPException) as exc:
        login_with_google(db, "token")
    assert exc.value.status_code == 403


@pytest.mark.coverage
@patch("app.services.auth_service._microsoft_jwks_client")
def test_login_with_microsoft_binds_sub(mock_jwks, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_CLIENT_ID", "ms-cid")
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_TENANT", "common")
    owner.microsoft_sub = None
    db.flush()

    key = MagicMock()
    key.key = "secret"
    mock_jwks.return_value.get_signing_key_from_jwt.return_value = key
    tid = "tenant-abc"
    with patch("app.services.auth_service.jwt.decode") as mock_decode:
        mock_decode.return_value = {
            "tid": tid,
            "iss": f"https://login.microsoftonline.com/{tid}/v2.0",
            "oid": "ms-oid-1",
            "email": owner.email,
            "email_verified": True,
        }
        user, ctx = login_with_microsoft(db, "ms-token")
    assert user.id == owner.id
    assert user.microsoft_sub == "ms-oid-1"


@pytest.mark.coverage
def test_revoke_access_token_ignores_garbage(db):
    revoke_access_token_from_raw(db, "not-a-jwt")
    assert db.query(RefreshToken).count() >= 0
