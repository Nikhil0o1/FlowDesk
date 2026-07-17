"""Phase 5 regression — smoke tests for release-critical flows."""
import pytest

from app.tests.conftest import auth_headers, seed_login_otp


@pytest.mark.regression
def test_health_regression(client):
    assert client.get("/health").json()["status"] == "ok"


@pytest.mark.regression
def test_otp_login_logout_regression(client, owner, db):
    seed_login_otp(db, owner.email, "424242")
    login = client.post(
        "/api/v1/auth/otp/verify",
        json={"email": owner.email, "code": "424242"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


@pytest.mark.regression
def test_authenticated_me_regression(client, owner):
    headers = auth_headers(client, owner.email)
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["email"] == owner.email


@pytest.mark.regression
def test_org_list_regression(client, org, owner):
    response = client.get("/api/v1/organizations", headers=auth_headers(client, owner.email))
    assert response.status_code == 200
    assert any(o["id"] == str(org.id) for o in response.json())


@pytest.mark.regression
def test_refresh_token_smoke(client, owner, db):
    seed_login_otp(db, owner.email, "808080")
    login = client.post(
        "/api/v1/auth/otp/verify",
        json={"email": owner.email, "code": "808080"},
    )
    assert login.status_code == 200
    refresh_cookie = login.cookies.get("flowdesk_refresh")
    assert refresh_cookie

    refresh = client.post("/api/v1/auth/refresh", cookies={"flowdesk_refresh": refresh_cookie})
    assert refresh.status_code == 200
    token = refresh.json()["access_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


@pytest.mark.regression
def test_unauthenticated_api_rejected(client):
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/organizations").status_code == 401
    assert client.get("/api/v1/search", params={"q": "x"}).status_code == 401
