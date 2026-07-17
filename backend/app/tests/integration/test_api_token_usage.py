"""Integration tests for API key usage dashboard endpoints."""

import pytest

from app.core.pat_usage import clear_usage_memory_for_tests
from app.tests.conftest import auth_headers

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _clear_usage():
    clear_usage_memory_for_tests()
    yield
    clear_usage_memory_for_tests()


@pytest.mark.coverage
def test_usage_after_pat_request_and_ack_copied(client, db, owner):
    headers = auth_headers(client, owner.email)
    create = client.post(
        "/api/v1/users/me/api-tokens",
        json={"name": "Usage probe", "scopes": ["profile:read"]},
        headers=headers,
    )
    assert create.status_code == 201, create.text
    raw = create.json()["token"]
    token_id = create.json()["id"]
    assert "token" in create.json()

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {raw}"})
    assert me.status_code == 200

    # Missing scope → failed usage
    denied = client.get("/api/v1/organizations", headers={"Authorization": f"Bearer {raw}"})
    assert denied.status_code == 403

    usage = client.get(f"/api/v1/users/me/api-tokens/{token_id}/usage", headers=headers)
    assert usage.status_code == 200, usage.text
    body = usage.json()
    assert "token" not in body
    assert "secret" not in str(body).lower() or "secret_acknowledged" in str(body)
    assert body["requests_24h"] >= 2
    assert body["errors_24h"] >= 1
    assert body["metrics_available"] is True
    assert body["last_success_route"]
    assert body["status"] in {"healthy", "degraded", "failing", "idle"}
    assert any(a["event"] == "created" for a in body["activity"])

    ack = client.post(
        f"/api/v1/users/me/api-tokens/{token_id}/usage/ack-copied",
        headers=headers,
    )
    assert ack.status_code == 200

    usage2 = client.get(f"/api/v1/users/me/api-tokens/{token_id}/usage", headers=headers)
    assert any(a["event"] == "copied" for a in usage2.json()["activity"])

    # PAT cannot read usage
    blocked = client.get(
        f"/api/v1/users/me/api-tokens/{token_id}/usage",
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert blocked.status_code == 403
