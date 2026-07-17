"""Unit tests for MCP OAuth service helpers and edge cases."""

import uuid
from datetime import timedelta

import pytest

from app.services import mcp_oauth_service


def test_redirect_uri_matches_loopback_same_host():
    assert mcp_oauth_service.redirect_uri_matches(
        "http://127.0.0.1:8787/callback",
        "http://127.0.0.1:8787/callback",
    )
    assert not mcp_oauth_service.redirect_uri_matches(
        "https://evil.com/callback",
        "http://localhost:8787/callback",
    )


def test_is_allowed_redirect_claude_scheme():
    assert mcp_oauth_service._is_allowed_redirect_uri("claude://oauth/callback")


def test_parse_scopes_empty_when_missing():
    assert mcp_oauth_service.parse_scopes(None) == []
    assert mcp_oauth_service.parse_scopes("") == []
    assert mcp_oauth_service.parse_scopes("tasks:read") == ["tasks:read"]


def test_verify_pkce_rejects_bad_verifier():
    assert not mcp_oauth_service.verify_pkce("wrong", "challenge")


def test_validate_client_redirect_rejects_unregistered(db):
    client = mcp_oauth_service.register_client(
        db,
        client_name="Test",
        redirect_uris=["http://localhost:8787/callback"],
    )
    with pytest.raises(ValueError, match="Unregistered redirect_uri"):
        mcp_oauth_service.validate_client_redirect(client, "http://localhost:9999/other")


def test_get_authorization_request_missing(db):
    assert mcp_oauth_service.get_authorization_request(db, uuid.uuid4()) is None


def test_register_client_rejects_bad_redirect(db):
    with pytest.raises(ValueError, match="redirect_uri not allowed"):
        mcp_oauth_service.register_client(
            db,
            client_name="x",
            redirect_uris=["https://evil.com/callback"],
        )


def test_register_client_rejects_empty_redirects(db):
    with pytest.raises(ValueError, match="redirect_uris"):
        mcp_oauth_service.register_client(db, client_name="x", redirect_uris=[])


def test_register_client_rejects_bad_auth_method(db):
    with pytest.raises(ValueError, match="token_endpoint_auth_method"):
        mcp_oauth_service.register_client(
            db,
            client_name="x",
            redirect_uris=["http://localhost:8787/callback"],
            token_endpoint_auth_method="invalid",
        )


def test_create_authorization_request_invalid_client(db):
    with pytest.raises(LookupError):
        mcp_oauth_service.create_authorization_request(
            db,
            client_id="missing",
            redirect_uri="http://localhost:8787/callback",
            code_challenge="abc",
            state=None,
            scopes=["tasks:read"],
            resource=None,
        )


def test_approve_expired_request(db, owner):
    client = mcp_oauth_service.register_client(
        db,
        client_name="Test",
        redirect_uris=["http://localhost:8787/callback"],
    )
    db.commit()
    req = mcp_oauth_service.create_authorization_request(
        db,
        client_id=client.client_id,
        redirect_uri="http://localhost:8787/callback",
        code_challenge="abc",
        state="s",
        scopes=["tasks:read"],
        resource=None,
    )
    req.expires_at = mcp_oauth_service._now() - timedelta(minutes=1)
    db.commit()
    with pytest.raises(LookupError):
        mcp_oauth_service.approve_authorization_request(db, request_id=req.id, user_id=owner.id)


def test_exchange_invalid_code(db):
    with pytest.raises(LookupError):
        mcp_oauth_service.exchange_authorization_code(
            db,
            client_id=str(uuid.uuid4()),
            code="not-a-code",
            code_verifier="v",
            redirect_uri=None,
        )


def test_verify_access_token_invalid(db):
    assert mcp_oauth_service.verify_access_token(db, "fd_pat_invalid") is None


def test_oauth_metadata_helpers():
    meta = mcp_oauth_service.oauth_metadata(issuer="https://api.test", backend_url="https://api.test")
    assert meta["issuer"] == "https://api.test"
    prm = mcp_oauth_service.protected_resource_metadata(
        mcp_url="https://api.test/mcp",
        backend_url="https://api.test",
    )
    assert prm["resource"] == "https://api.test/mcp"
