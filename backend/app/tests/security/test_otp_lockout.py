"""Phase 4 security — OTP lockout integration through auth API."""
import pytest

from app.services.login_lockout_service import clear_lockout
from app.tests.conftest import seed_login_otp


@pytest.mark.security
def test_otp_verify_lockout_after_repeated_failures(client, owner, db, monkeypatch):
    monkeypatch.setattr("app.services.login_lockout_service.settings.OTP_LOCKOUT_ATTEMPTS", 3)
    email = owner.email
    clear_lockout(email)

    for _ in range(3):
        seed_login_otp(db, email, "111111")
        response = client.post(
            "/api/v1/auth/otp/verify",
            json={"email": email, "code": "999999"},
        )
        assert response.status_code == 401

    seed_login_otp(db, email, "111111")
    locked = client.post(
        "/api/v1/auth/otp/verify",
        json={"email": email, "code": "111111"},
    )
    assert locked.status_code == 429
    clear_lockout(email)


@pytest.mark.security
def test_otp_request_does_not_enumerate_unknown_email(client, db):
    response = client.post("/api/v1/auth/otp/request", json={"email": "ghost@test.dev"})
    assert response.status_code == 200
    assert "detail" in response.json() or response.json().get("detail")
