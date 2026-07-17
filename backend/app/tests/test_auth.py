from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.security import hash_token
from app.models.user import LoginOtp
from app.tests.conftest import auth_headers, make_user


def _seed_otp(db, email: str, code: str = "123456") -> LoginOtp:
    otp = LoginOtp(
        email=email,
        code_hash=hash_token(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(otp)
    db.flush()
    return otp


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_otp_request_creates_code_for_known_user(client, owner, db):
    response = client.post("/api/v1/auth/otp/request", json={"email": "owner@test.dev"})
    assert response.status_code == 200, response.text
    otp = db.scalar(select(LoginOtp).where(LoginOtp.email == "owner@test.dev"))
    assert otp is not None and otp.consumed_at is None


def test_otp_request_unknown_email_is_silent(client, db):
    # Same response, but no code is created (no account enumeration).
    response = client.post("/api/v1/auth/otp/request", json={"email": "nobody@test.dev"})
    assert response.status_code == 200
    assert db.scalar(select(LoginOtp).where(LoginOtp.email == "nobody@test.dev")) is None


def test_otp_verify_success_returns_tokens(client, owner, db):
    _seed_otp(db, "owner@test.dev", "654321")
    response = client.post(
        "/api/v1/auth/otp/verify", json={"email": "owner@test.dev", "code": "654321"}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["access_token"]
    assert data["user"]["email"] == "owner@test.dev"
    assert data["login_context"]["redirect_to"]
    # refresh token is an httpOnly cookie, never in the body
    assert "refresh" not in data
    assert "flowdesk_refresh" in response.cookies


def test_otp_verify_wrong_code_rejected(client, owner, db):
    _seed_otp(db, "owner@test.dev", "111111")
    response = client.post(
        "/api/v1/auth/otp/verify", json={"email": "owner@test.dev", "code": "999999"}
    )
    assert response.status_code == 401


def test_refresh_rotation(client, owner, db):
    _seed_otp(db, "owner@test.dev", "222222")
    login = client.post(
        "/api/v1/auth/otp/verify", json={"email": "owner@test.dev", "code": "222222"}
    )
    assert login.status_code == 200
    first_cookie = login.cookies["flowdesk_refresh"]

    refresh = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": first_cookie})
    assert refresh.status_code == 200
    second_cookie = refresh.cookies["flowdesk_refresh"]
    assert second_cookie != first_cookie

    # Within the 30s grace window, replaying a just-rotated token is tolerated (multi-tab race)
    reuse = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": first_cookie})
    assert reuse.status_code == 200


def test_session_establish_does_not_rotate(client, owner, db):
    _seed_otp(db, "owner@test.dev", "333333")
    login = client.post(
        "/api/v1/auth/otp/verify", json={"email": "owner@test.dev", "code": "333333"}
    )
    assert login.status_code == 200
    cookie = login.cookies["flowdesk_refresh"]

    establish = client.post("/api/v1/auth/session/establish", cookies={"flowdesk_refresh": cookie})
    assert establish.status_code == 200
    assert establish.json()["access_token"]

    establish_again = client.post(
        "/api/v1/auth/session/establish", cookies={"flowdesk_refresh": cookie}
    )
    assert establish_again.status_code == 200

    refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": cookie})
    assert refresh.status_code == 200
    assert refresh.json()["access_token"]


def test_me_requires_auth(client):
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_returns_profile(client, owner):
    headers = auth_headers(client, "owner@test.dev")
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["user"]["profile"]["full_name"]


def test_logout_revokes_access_token(client, owner):
    headers = auth_headers(client, "owner@test.dev")
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200

    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_inactive_user_cannot_verify_otp(client, db):
    user = make_user(db, "inactive@test.dev")
    user.is_active = False
    db.flush()
    _seed_otp(db, "inactive@test.dev", "333333")
    response = client.post(
        "/api/v1/auth/otp/verify", json={"email": "inactive@test.dev", "code": "333333"}
    )
    assert response.status_code == 401
