"""API tests for integration OAuth apps (org CRUD + authorize/token)."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from app.core.api_key_digest import clear_pepper_cache
from app.tests.conftest import auth_headers
from app.services import integration_oauth_service as svc


@pytest.fixture(autouse=True)
def _clear_peppers(monkeypatch):
    monkeypatch.setenv("API_KEY_PEPPERS", "")
    clear_pepper_cache()
    from app.core import config

    monkeypatch.setattr(config.settings, "API_KEY_PEPPERS", "")
    monkeypatch.setattr(config.settings, "API_KEY_PEPPER_CURRENT", 1)
    clear_pepper_cache()
    yield
    clear_pepper_cache()


def test_oauth_app_crud_and_token_flow(client, db, org, owner, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "FRONTEND_URL", "https://app.example.com")
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/organizations/{org.id}/oauth-apps",
        headers=headers,
        json={
            "name": "Holocron",
            "redirect_uris": ["http://localhost:8000/oauth/callback"],
            "default_scopes": ["tasks:read", "profile:read"],
        },
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["client_id"].startswith("fd_app_")
    assert body["client_secret"].startswith("fd_appsec_")
    assert "FLOWDESK_CLIENT_ID=" in body["env_snippet"]
    app_id = body["id"]
    client_id = body["client_id"]
    client_secret = body["client_secret"]

    listed = client.get(
        f"/api/v1/organizations/{org.id}/oauth-apps",
        headers=headers,
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    got = client.get(
        f"/api/v1/organizations/{org.id}/oauth-apps/{app_id}",
        headers=headers,
    )
    assert got.status_code == 200
    assert got.json()["name"] == "Holocron"

    patched = client.patch(
        f"/api/v1/organizations/{org.id}/oauth-apps/{app_id}",
        headers=headers,
        json={"name": "Holocron Prod"},
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Holocron Prod"

    regen = client.post(
        f"/api/v1/organizations/{org.id}/oauth-apps/{app_id}/regenerate-secret",
        headers=headers,
    )
    assert regen.status_code == 200
    client_secret = regen.json()["client_secret"]

    authz = client.get(
        "/api/v1/oauth/integrations/authorize",
        params={
            "client_id": client_id,
            "redirect_uri": "http://localhost:8000/oauth/callback",
            "state": "s1",
        },
        follow_redirects=False,
    )
    assert authz.status_code == 302
    loc = authz.headers["location"]
    assert loc.startswith("https://app.example.com/oauth/integrations?")
    request_id = parse_qs(urlparse(loc).query)["request_id"][0]

    detail = client.get(
        f"/api/v1/oauth/integrations/requests/{request_id}",
        headers=headers,
    )
    assert detail.status_code == 200
    assert detail.json()["client_id"] == client_id

    approve = client.post(
        "/api/v1/oauth/integrations/approve",
        headers=headers,
        json={"request_id": request_id},
    )
    assert approve.status_code == 200
    redirect_to = approve.json()["redirect_to"]
    code = parse_qs(urlparse(redirect_to).query)["code"][0]

    token = client.post(
        "/api/v1/oauth/integrations/token",
        headers={"Content-Type": "application/json"},
        json={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        },
    )
    assert token.status_code == 200, token.text
    assert token.json()["access_token"].startswith("fd_live_")
    assert token.json()["token_type"] == "Bearer"

    authorized = client.get(
        "/api/v1/oauth/integrations/authorized-apps",
        headers=headers,
    )
    assert authorized.status_code == 200
    assert len(authorized.json()) == 1

    unauth = client.delete(
        f"/api/v1/oauth/integrations/authorized-apps/{app_id}",
        headers=headers,
    )
    assert unauth.status_code == 200

    revoke = client.delete(
        f"/api/v1/organizations/{org.id}/oauth-apps/{app_id}",
        headers=headers,
    )
    assert revoke.status_code == 200


def test_authorize_invalid_client(client):
    res = client.get(
        "/api/v1/oauth/integrations/authorize",
        params={
            "client_id": "fd_app_MISSING",
            "redirect_uri": "http://localhost:8000/cb",
        },
        follow_redirects=False,
    )
    assert res.status_code == 400


def test_token_invalid_json(client, db, org, owner):
    raw_secret, app = svc.create_app(
        db,
        organization_id=org.id,
        created_by_user_id=owner.id,
        name="App",
        redirect_uris=["http://localhost:8000/cb"],
    )
    db.flush()
    _ = raw_secret
    res = client.post(
        "/api/v1/oauth/integrations/token",
        content=b"not-json",
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_request"

    res2 = client.post(
        "/api/v1/oauth/integrations/token",
        data={
            "client_id": app.client_id,
            "client_secret": "wrong",
            "code": "x",
        },
    )
    assert res2.status_code == 401
    assert res2.json()["error"] == "invalid_client"


def test_oauth_app_not_found(client, org, owner):
    import uuid

    headers = auth_headers(client, owner.email)
    res = client.get(
        f"/api/v1/organizations/{org.id}/oauth-apps/{uuid.uuid4()}",
        headers=headers,
    )
    assert res.status_code == 404
