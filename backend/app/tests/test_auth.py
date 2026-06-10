from app.tests.conftest import auth_headers, make_user


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_login_success_returns_tokens_and_user(client, owner):
    response = client.post(
        "/api/v1/auth/login", json={"email": "owner@test.dev", "password": "Password123!"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["access_token"]
    assert data["user"]["email"] == "owner@test.dev"
    # refresh token must be an httpOnly cookie, never in the body
    assert "refresh" not in data
    assert "flowdesk_refresh" in response.cookies


def test_login_wrong_password_rejected(client, owner):
    response = client.post(
        "/api/v1/auth/login", json={"email": "owner@test.dev", "password": "wrong-password"}
    )
    assert response.status_code == 401


def test_refresh_rotation(client, owner):
    login = client.post(
        "/api/v1/auth/login", json={"email": "owner@test.dev", "password": "Password123!"}
    )
    first_cookie = login.cookies["flowdesk_refresh"]

    refresh = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": first_cookie})
    assert refresh.status_code == 200
    second_cookie = refresh.cookies["flowdesk_refresh"]
    assert second_cookie != first_cookie

    # Reusing the rotated (old) token must fail and kill the family
    reuse = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": first_cookie})
    assert reuse.status_code == 401
    replay_new = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": second_cookie})
    assert replay_new.status_code == 401  # family revoked by reuse detection


def test_me_requires_auth(client):
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_returns_profile(client, owner):
    headers = auth_headers(client, "owner@test.dev")
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["profile"]["full_name"]


def test_inactive_user_cannot_login(client, db):
    user = make_user(db, "inactive@test.dev")
    user.is_active = False
    db.flush()
    response = client.post(
        "/api/v1/auth/login", json={"email": "inactive@test.dev", "password": "Password123!"}
    )
    assert response.status_code == 401
