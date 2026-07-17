"""Phase 4 security — refresh token family reuse detection."""
import pytest

from app.tests.conftest import seed_login_otp


@pytest.mark.security
def test_refresh_token_reuse_outside_grace_window_revoked(client, owner, db, monkeypatch):
    """Replaying a stale refresh token after the rotation grace window must fail."""
    from datetime import datetime, timedelta, timezone

    seed_login_otp(db, owner.email, "555555")
    login = client.post(
        "/api/v1/auth/otp/verify",
        json={"email": owner.email, "code": "555555"},
    )
    assert login.status_code == 200
    old_cookie = login.cookies["flowdesk_refresh"]

    refresh = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": old_cookie})
    assert refresh.status_code == 200

    real_now = datetime.now(timezone.utc)

    def fake_now():
        return real_now + timedelta(seconds=31)

    monkeypatch.setattr("app.services.auth_service._now", fake_now)

    reuse = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": old_cookie})
    assert reuse.status_code == 401


@pytest.mark.security
def test_malformed_refresh_cookie_rejected(client):
    response = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": "not-a-valid-token"})
    assert response.status_code == 401
