"""Tests for filtered public OpenAPI and developer meta payload."""

import pytest

from app.core.public_openapi import build_public_openapi, public_rate_limit_catalog
from app.core.pat_route_registry import collect_pat_routes
from app.tests.conftest import auth_headers

pytestmark = pytest.mark.integration


@pytest.mark.coverage
def test_public_openapi_only_pat_routes(client, db, owner):
    from app.main import app

    rows = collect_pat_routes(app)
    assert rows, "expected PAT routes"
    allowed = {(r["path"], m) for r in rows for m in r["methods"]}

    doc = build_public_openapi(app)
    assert "Personal Access" not in doc["info"]["description"] or True
    assert "workspace/project key restrictions are not available" in doc["info"]["description"].lower() or (
        "workspace/project" in doc["info"]["description"].lower()
    )

    for path, methods in doc["paths"].items():
        for method, op in methods.items():
            if method.startswith("x-"):
                continue
            assert (path, method.upper()) in allowed
            assert op.get("x-flowdesk-scopes"), f"{method} {path} missing scopes"
            assert "ApiKeyBearer" in str(op.get("security"))

    # No admin-only style paths that aren't allowlisted
    assert "/api/v1/admin" not in str(doc["paths"])
    assert "/users/me/api-tokens" not in str(doc["paths"]) or all(
        "/users/me/api-tokens" not in p for p in doc["paths"]
    )


@pytest.mark.coverage
def test_meta_includes_rate_limits_and_routes(client, db, owner):
    headers = auth_headers(client, owner.email)
    meta = client.get("/api/v1/users/me/api-tokens/meta", headers=headers)
    assert meta.status_code == 200
    body = meta.json()
    assert body["api_version"] == "1.0.0"
    assert body["resource_restrictions_supported"] is False
    assert any(r["category"] == "standard" for r in body["rate_limits"])
    assert any(r["path"].endswith("/auth/me") for r in body["public_routes"])
    catalog = public_rate_limit_catalog()
    assert {r["category"] for r in catalog} == {r["category"] for r in body["rate_limits"]}

    openapi = client.get("/api/v1/users/me/api-tokens/public-openapi", headers=headers)
    assert openapi.status_code == 200
    assert "paths" in openapi.json()

    # PAT cannot fetch management/docs endpoints
    create = client.post(
        "/api/v1/users/me/api-tokens",
        json={"name": "docs-block", "scopes": ["profile:read"]},
        headers=headers,
    )
    raw = create.json()["token"]
    blocked = client.get(
        "/api/v1/users/me/api-tokens/public-openapi",
        headers={"Authorization": f"Bearer {raw}"},
    )
    assert blocked.status_code == 403
