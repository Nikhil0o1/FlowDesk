"""Integration tests for MCP tool invocation audit log."""

import hashlib

import pytest

from app.services import api_token_service
from app.tests.conftest import auth_headers

pytestmark = pytest.mark.integration


@pytest.mark.coverage
def test_mcp_audit_log_and_list(client, db, owner):
    jwt_headers = auth_headers(client, owner.email)
    raw, token = api_token_service.create_pat(
        db,
        user_id=owner.id,
        name="MCP audit test",
        scopes=["tasks:read", "mcp:audit"],
    )
    db.commit()
    pat_headers = {"Authorization": f"Bearer {raw}"}

    args_hash = hashlib.sha256(b'{"query":"test"}').hexdigest()
    log = client.post(
        "/api/v1/mcp/audit",
        headers=pat_headers,
        json={
            "tool": "flowdesk_search",
            "args_hash": args_hash,
            "status": "ok",
            "resource_ids": [],
            "duration_ms": 42,
        },
    )
    assert log.status_code == 204

    jwt_only = client.get("/api/v1/mcp/audit", headers=pat_headers)
    assert jwt_only.status_code == 403

    listed = client.get("/api/v1/mcp/audit", headers=jwt_headers)
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) >= 1
    hit = next(r for r in rows if r["tool"] == "flowdesk_search")
    assert hit["status"] == "ok"
    assert hit["duration_ms"] == 42
    assert hit["token_prefix"] is not None


@pytest.mark.coverage
def test_mcp_audit_rejects_jwt(client, owner):
    headers = auth_headers(client, owner.email)
    args_hash = hashlib.sha256(b"{}").hexdigest()
    res = client.post(
        "/api/v1/mcp/audit",
        headers=headers,
        json={
            "tool": "flowdesk_whoami",
            "args_hash": args_hash,
            "status": "ok",
        },
    )
    assert res.status_code == 403
