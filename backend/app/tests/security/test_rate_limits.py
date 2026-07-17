"""Phase 4 security — API rate limiting returns 429 when exceeded."""
import pytest

from app.tests.conftest import seed_login_otp


@pytest.mark.security
def test_otp_request_rate_limited(client, rate_limits_on, monkeypatch):
    monkeypatch.setattr("app.api.v1.auth._OTP_REQUEST_MIN_SECONDS", 0)

    for i in range(5):
        response = client.post("/api/v1/auth/otp/request", json={"email": f"user{i}@test.dev"})
        assert response.status_code == 200, response.text

    blocked = client.post("/api/v1/auth/otp/request", json={"email": "blocked@test.dev"})
    assert blocked.status_code == 429


@pytest.mark.security
def test_otp_verify_rate_limited(client, owner, db, rate_limits_on, monkeypatch):
    monkeypatch.setattr("app.services.login_lockout_service.settings.OTP_LOCKOUT_ATTEMPTS", 100)
    for i in range(10):
        seed_login_otp(db, owner.email, f"{100000 + i}")
        response = client.post(
            "/api/v1/auth/otp/verify",
            json={"email": owner.email, "code": "000000"},
        )
        assert response.status_code == 401

    seed_login_otp(db, owner.email, "999999")
    blocked = client.post(
        "/api/v1/auth/otp/verify",
        json={"email": owner.email, "code": "999999"},
    )
    assert blocked.status_code == 429
