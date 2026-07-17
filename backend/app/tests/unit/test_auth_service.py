"""Phase 2 unit tests — auth_service token lifecycle and OTP verification."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.core.security import create_access_token, decode_access_token, hash_token
from app.models.user import LoginOtp, RefreshToken, RevokedAccessToken
from app.services.auth_service import (
    AuthError,
    _microsoft_allowed_tenant,
    is_access_token_revoked,
    issue_tokens,
    revoke_access_token_from_raw,
    revoke_all_user_tokens,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_login_otp,
)
from app.services.login_lockout_service import clear_lockout
from app.tests.conftest import make_user, seed_login_otp


@pytest.mark.unit
def test_issue_tokens_stores_hashed_refresh_only(db, org, owner):
    access, raw_refresh = issue_tokens(db, owner)
    db.flush()

    assert access
    assert len(raw_refresh) > 20
    stored = db.scalars(select(RefreshToken).where(RefreshToken.user_id == owner.id)).all()
    assert len(stored) == 1
    assert stored[0].token_hash == hash_token(raw_refresh)
    assert decode_access_token(access) is not None


@pytest.mark.unit
def test_rotate_refresh_token_returns_new_pair(db, org, owner):
    _, raw = issue_tokens(db, owner)
    db.commit()

    access, raw_new, user, ctx = rotate_refresh_token(db, raw)
    assert user.id == owner.id
    assert raw_new != raw
    assert decode_access_token(access)


@pytest.mark.unit
def test_rotate_invalid_refresh_raises(db):
    with pytest.raises(AuthError):
        rotate_refresh_token(db, "totally-invalid-token")


@pytest.mark.unit
def test_establish_session_from_refresh(db, org, owner):
    from app.services.auth_service import establish_session_from_refresh, issue_tokens

    _access, raw = issue_tokens(db, owner)
    db.commit()

    access, user, ctx = establish_session_from_refresh(db, raw)
    assert access
    assert user.id == owner.id
    assert ctx.redirect_to

    access2, user2, _ctx2 = establish_session_from_refresh(db, raw)
    assert access2
    assert user2.id == owner.id


def test_revoke_refresh_token_marks_record(db, org, owner):
    _, raw = issue_tokens(db, owner)
    db.flush()
    revoke_refresh_token(db, raw)
    db.flush()

    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    assert record.revoked_at is not None


@pytest.mark.unit
def test_revoke_access_token_blocklists_jti(db, org, owner):
    access, _ = issue_tokens(db, owner)
    db.flush()
    payload = decode_access_token(access)
    revoke_access_token_from_raw(db, access)
    db.flush()

    assert is_access_token_revoked(db, payload["jti"])
    row = db.scalar(select(RevokedAccessToken).where(RevokedAccessToken.jti == payload["jti"]))
    assert row is not None


@pytest.mark.unit
def test_revoke_all_user_tokens(db, org, owner):
    issue_tokens(db, owner)
    issue_tokens(db, owner)
    db.flush()
    revoke_all_user_tokens(db, owner.id)
    db.flush()

    active = db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == owner.id, RefreshToken.revoked_at.is_(None)
        )
    ).all()
    assert active == []


@pytest.mark.unit
def test_verify_login_otp_success(db, org, owner):
    clear_lockout(owner.email)
    seed_login_otp(db, owner.email, "987654")
    user, ctx = verify_login_otp(db, owner.email, "987654")
    assert user.id == owner.id
    assert ctx.kind == "org_owner"


@pytest.mark.unit
def test_verify_login_otp_wrong_code_raises(db, org, owner):
    clear_lockout(owner.email)
    seed_login_otp(db, owner.email, "111111")
    with pytest.raises(AuthError):
        verify_login_otp(db, owner.email, "000000")


@pytest.mark.unit
def test_verify_login_otp_expired_raises(db, org, owner):
    clear_lockout(owner.email)
    otp = seed_login_otp(db, owner.email, "222222")
    otp.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.flush()
    with pytest.raises(AuthError):
        verify_login_otp(db, owner.email, "222222")


@pytest.mark.unit
def test_microsoft_allowed_tenant_organizations_rejects_consumer(monkeypatch):
    from app.services.auth_service import _MS_CONSUMER_TENANT

    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_TENANT", "organizations")
    assert _microsoft_allowed_tenant("work-tenant-id") is True
    assert _microsoft_allowed_tenant(_MS_CONSUMER_TENANT) is False


@pytest.mark.unit
@patch("app.services.auth_service.google_id_token.verify_oauth2_token")
def test_login_with_google_binds_sub(mock_verify, db, org, owner, monkeypatch):
    from app.services.auth_service import login_with_google

    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "cid")
    owner.google_sub = None
    db.flush()
    mock_verify.return_value = {
        "email": owner.email,
        "email_verified": True,
        "sub": "google-sub-xyz",
    }

    user, ctx = login_with_google(db, "fake-token")
    assert user.id == owner.id
    assert user.google_sub == "google-sub-xyz"
    assert ctx.kind == "org_owner"
