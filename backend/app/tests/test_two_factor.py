"""TOTP two-factor auth: enrollment, login challenge, recovery codes, org enforcement."""
from app.core.security import hash_token
from app.models.user import TwoFactorRecoveryCode
from app.tests.conftest import auth_headers, seed_login_otp, seed_totp, totp_now

V = "/api/v1/auth/otp/verify"


def test_otp_login_without_2fa_returns_session(client, owner, db):
    seed_login_otp(db, "owner@test.dev", "111111")
    r = client.post(V, json={"email": "owner@test.dev", "code": "111111"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "authenticated"
    assert data["access_token"]


def test_enrolled_user_must_pass_totp(client, owner, db):
    secret = seed_totp(db, owner)
    seed_login_otp(db, "owner@test.dev", "222222")
    data = client.post(V, json={"email": "owner@test.dev", "code": "222222"}).json()
    assert data["status"] == "totp_required"
    assert data["access_token"] is None
    challenge = data["challenge_token"]

    bad = client.post("/api/v1/auth/2fa/verify", json={"challenge_token": challenge, "code": "000000"})
    assert bad.status_code == 401

    good = client.post(
        "/api/v1/auth/2fa/verify", json={"challenge_token": challenge, "code": totp_now(secret)}
    )
    assert good.status_code == 200
    assert good.json()["access_token"]


def test_login_with_recovery_code_then_reuse_fails(client, owner, db):
    seed_totp(db, owner)
    db.add(TwoFactorRecoveryCode(user_id=owner.id, code_hash=hash_token("rescue-code-1")))
    db.flush()

    seed_login_otp(db, "owner@test.dev", "333333")
    challenge = client.post(V, json={"email": "owner@test.dev", "code": "333333"}).json()["challenge_token"]
    r = client.post("/api/v1/auth/2fa/verify", json={"challenge_token": challenge, "code": "rescue-code-1"})
    assert r.status_code == 200

    # The same recovery code can't be used twice.
    seed_login_otp(db, "owner@test.dev", "444444")
    challenge2 = client.post(V, json={"email": "owner@test.dev", "code": "444444"}).json()["challenge_token"]
    r2 = client.post("/api/v1/auth/2fa/verify", json={"challenge_token": challenge2, "code": "rescue-code-1"})
    assert r2.status_code == 401


def test_org_enforced_enrollment_required_at_login(client, owner, org, db):
    org.require_2fa = True
    db.flush()
    seed_login_otp(db, "owner@test.dev", "555555")
    data = client.post(V, json={"email": "owner@test.dev", "code": "555555"}).json()
    assert data["status"] == "totp_enrollment_required"
    challenge = data["challenge_token"]

    setup = client.post("/api/v1/auth/2fa/setup", json={"challenge_token": challenge}).json()
    secret = setup["secret"]
    confirm = client.post(
        "/api/v1/auth/2fa/confirm", json={"challenge_token": challenge, "code": totp_now(secret)}
    )
    assert confirm.status_code == 200
    body = confirm.json()
    assert body["access_token"]
    assert len(body["recovery_codes"]) == 10


def test_settings_enroll_status_and_disable(client, owner, db):
    headers = auth_headers(client, "owner@test.dev")

    status = client.get("/api/v1/users/me/2fa", headers=headers).json()
    assert status["enrolled"] is False

    secret = client.post("/api/v1/users/me/2fa/setup", headers=headers).json()["secret"]
    confirm = client.post(
        "/api/v1/users/me/2fa/confirm", json={"code": totp_now(secret)}, headers=headers
    )
    assert confirm.status_code == 200
    assert len(confirm.json()["recovery_codes"]) == 10

    status2 = client.get("/api/v1/users/me/2fa", headers=headers).json()
    assert status2["enrolled"] is True and status2["recovery_codes_remaining"] == 10

    disabled = client.delete("/api/v1/users/me/2fa", headers=headers)
    assert disabled.status_code == 200
    assert client.get("/api/v1/users/me/2fa", headers=headers).json()["enrolled"] is False


def test_disable_blocked_when_org_requires_2fa(client, owner, org, db):
    seed_totp(db, owner)
    org.require_2fa = True
    db.flush()
    headers = auth_headers(client, "owner@test.dev")
    r = client.delete("/api/v1/users/me/2fa", headers=headers)
    assert r.status_code == 409


def test_wrong_confirm_code_does_not_enable(client, owner, db):
    headers = auth_headers(client, "owner@test.dev")
    client.post("/api/v1/users/me/2fa/setup", headers=headers)
    bad = client.post("/api/v1/users/me/2fa/confirm", json={"code": "000000"}, headers=headers)
    assert bad.status_code == 400
    assert client.get("/api/v1/users/me/2fa", headers=headers).json()["enrolled"] is False
