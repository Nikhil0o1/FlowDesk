"""Integration tests for personal access tokens (MCP / automation)."""
import pytest

from app.services import api_token_service
from app.tests.conftest import auth_headers
from app.tests.helpers import build_project_stack

pytestmark = pytest.mark.integration


@pytest.mark.coverage
def test_create_list_and_revoke_pat(client, db, owner):
    headers = auth_headers(client, owner.email)
    create = client.post(
        "/api/v1/users/me/api-tokens",
        json={
            "name": "Cursor MCP",
            "scopes": ["profile:read", "tasks:read", "tasks:write", "search:read"],
        },
        headers=headers,
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["name"] == "Cursor MCP"
    assert body["token"].startswith("fd_live_")
    assert "tasks:read" in body["scopes"]
    raw = body["token"]
    token_id = body["id"]

    listed = client.get("/api/v1/users/me/api-tokens", headers=headers)
    assert listed.status_code == 200
    assert any(t["id"] == token_id for t in listed.json())

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {raw}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == owner.email

    # Roles endpoint is not PAT-allowlisted
    roles = client.get("/api/v1/users/me/roles", headers={"Authorization": f"Bearer {raw}"})
    assert roles.status_code == 403

    revoked = client.delete(f"/api/v1/users/me/api-tokens/{token_id}", headers=headers)
    assert revoked.status_code == 200

    me_after = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {raw}"})
    assert me_after.status_code == 401


@pytest.mark.coverage
def test_pat_cannot_create_pat(client, db, owner):
    headers = auth_headers(client, owner.email)
    create = client.post(
        "/api/v1/users/me/api-tokens",
        json={"name": "bootstrap", "scopes": ["profile:read"]},
        headers=headers,
    )
    raw = create.json()["token"]
    pat_headers = {"Authorization": f"Bearer {raw}"}

    blocked = client.post(
        "/api/v1/users/me/api-tokens",
        json={"name": "nested", "scopes": ["profile:read"]},
        headers=pat_headers,
    )
    assert blocked.status_code == 403


@pytest.mark.coverage
def test_pat_can_search_and_list_tasks(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    raw, _ = api_token_service.create_pat(
        db,
        user_id=owner.id,
        name="test",
        scopes=["search:read", "tasks:read", "projects:read"],
    )
    db.commit()
    pat_headers = {"Authorization": f"Bearer {raw}"}

    search = client.get("/api/v1/search?q=Task&limit=5", headers=pat_headers)
    assert search.status_code == 200

    tasks = client.get("/api/v1/me/tasks?relation=assigned", headers=pat_headers)
    assert tasks.status_code == 200

    projects = client.get(
        f"/api/v1/workspaces/{workspace.id}/projects",
        headers=pat_headers,
    )
    assert projects.status_code == 200


@pytest.mark.coverage
def test_invalid_pat_rejected(client):
    resp = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer fd_pat_invalid"})
    assert resp.status_code == 401


@pytest.mark.coverage
def test_api_token_meta_jwt_only_and_safe(client, db, owner):
    headers = auth_headers(client, owner.email)
    meta = client.get("/api/v1/users/me/api-tokens/meta", headers=headers)
    assert meta.status_code == 200, meta.text
    body = meta.json()
    assert body["identity_model"] == "user_bound"
    assert body["resource_restrictions_supported"] is False
    assert body["rotation_grace_seconds"] > 0
    assert any(s["scope"] == "tasks:read" for s in body["scopes"])
    assert any(s["scope"] == "tasks:write" for s in body["scopes"])
    for s in body["scopes"]:
        assert "pepper" not in s["description"].lower()
        assert "hash" not in s["description"].lower()

    raw, _ = api_token_service.create_pat(
        db, user_id=owner.id, name="meta-check", scopes=["profile:read"]
    )
    db.commit()
    blocked = client.get(
        "/api/v1/users/me/api-tokens/meta",
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert blocked.status_code == 403


@pytest.mark.coverage
def test_list_get_rename_never_return_secret(client, db, owner):
    headers = auth_headers(client, owner.email)
    create = client.post(
        "/api/v1/users/me/api-tokens",
        json={"name": "Meta only", "scopes": ["profile:read"], "expires_in_days": 30},
        headers=headers,
    )
    assert create.status_code == 201
    raw = create.json()["token"]
    token_id = create.json()["id"]
    assert "secret_digest" not in create.json()
    assert "pepper_version" not in create.json()

    listed = client.get("/api/v1/users/me/api-tokens?include_revoked=true", headers=headers)
    assert listed.status_code == 200
    row = next(t for t in listed.json() if t["id"] == token_id)
    assert "token" not in row
    assert "secret_digest" not in row
    assert raw not in listed.text

    got = client.get(f"/api/v1/users/me/api-tokens/{token_id}", headers=headers)
    assert got.status_code == 200
    assert "token" not in got.json()
    assert raw not in got.text

    renamed = client.patch(
        f"/api/v1/users/me/api-tokens/{token_id}",
        json={"name": "Renamed key"},
        headers=headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Renamed key"
    assert "token" not in renamed.json()

    # PAT cannot list / rename / get management endpoints
    pat_headers = {"Authorization": f"Bearer {raw}"}
    assert client.get("/api/v1/users/me/api-tokens", headers=pat_headers).status_code == 403
    assert client.get(f"/api/v1/users/me/api-tokens/{token_id}", headers=pat_headers).status_code == 403
    assert (
        client.patch(
            f"/api/v1/users/me/api-tokens/{token_id}",
            json={"name": "hack"},
            headers=pat_headers,
        ).status_code
        == 403
    )


@pytest.mark.coverage
def test_create_defaults_empty_scopes_and_allows_no_expiry(client, db, owner):
    headers = auth_headers(client, owner.email)
    create = client.post(
        "/api/v1/users/me/api-tokens",
        json={"name": "Empty scopes", "scopes": [], "expires_in_days": None},
        headers=headers,
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["scopes"] == []
    assert body["expires_at"] is None
    assert body["token"].startswith("fd_live_")
