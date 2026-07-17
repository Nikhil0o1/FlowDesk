"""Phase 3 integration — authentication flows (OTP, refresh, logout)."""
import pytest

from app.tests.conftest import auth_headers, seed_login_otp


@pytest.mark.integration
def test_otp_login_refresh_logout_flow(client, owner, db):
    seed_login_otp(db, owner.email, "135790")
    login = client.post(
        "/api/v1/auth/otp/verify",
        json={"email": owner.email, "code": "135790"},
    )
    assert login.status_code == 200, login.text
    data = login.json()
    assert data["access_token"]
    assert data["login_context"]["kind"] == "org_owner"
    assert "flowdesk_refresh" in login.cookies

    headers = {"Authorization": f"Bearer {data['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200

    refresh = client.post(
        "/api/v1/auth/refresh",
        cookies={"flowdesk_refresh": login.cookies["flowdesk_refresh"]},
    )
    assert refresh.status_code == 200
    new_token = refresh.json()["access_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200

    assert client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_token}"}).status_code == 401


@pytest.mark.integration
def test_otp_request_and_verify_integration(client, owner, db):
    request = client.post("/api/v1/auth/otp/request", json={"email": owner.email})
    assert request.status_code == 200

    from sqlalchemy import select
    from app.models.user import LoginOtp

    otp = db.scalar(select(LoginOtp).where(LoginOtp.email == owner.email))
    assert otp is not None


@pytest.mark.integration
def test_unauthenticated_me_rejected(client):
    assert client.get("/api/v1/auth/me").status_code == 401
