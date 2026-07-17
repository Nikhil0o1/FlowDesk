"""Integration tests for MCP OAuth connect flow."""

import base64
import hashlib
import json
import secrets
from urllib.parse import parse_qs, urlparse

from app.tests.conftest import auth_headers


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def test_oauth_metadata(client):
    res = client.get("/.well-known/oauth-authorization-server")
    assert res.status_code == 200
    data = res.json()
    assert data["response_types_supported"] == ["code"]
    assert "authorization_endpoint" in data
    assert "token_endpoint" in data


def test_oauth_protected_resource_mcp_path(client):
    """RFC 9728 path-specific PRM when MCP is colocated at /mcp."""
    res = client.get("/.well-known/oauth-protected-resource/mcp")
    assert res.status_code == 200
    body = res.json()
    assert body["resource"].endswith("/mcp")
    assert "authorization_servers" in body


def test_mcp_connect_info_requires_auth(client, owner):
    headers = auth_headers(client, owner.email)
    assert client.get("/api/v1/mcp/connect-info").status_code == 401
    res = client.get("/api/v1/mcp/connect-info", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["mcp_url"].endswith("/mcp")
    assert body["cursor_deeplink"].startswith("cursor://")
    assert body["claude_desktop_deeplink"].startswith("https://claude.ai/customize/connectors")
    assert "modal=add-custom-connector" in body["claude_desktop_deeplink"]
    assert body["claude_code_install_command"] == (
        f"claude mcp add --transport http flowdesk {body['mcp_url']} --scope user"
    )
    assert "\n" not in body["claude_code_install_command"]
    assert "claude mcp remove flowdesk --scope user" in body["claude_code_reset_command"]
    assert "claude mcp remove flowdesk --scope local" in body["claude_code_reset_command"]
    assert "claude mcp remove flowdesk --scope project" in body["claude_code_reset_command"]
    assert "claude mcp list" in body["claude_code_reset_command"]
    assert body["cursor_config"]["mcpServers"]["flowdesk"]["url"] == body["mcp_url"]
    assert body["claude_config"]["mcpServers"]["flowdesk"]["url"] == body["mcp_url"]
    qs = parse_qs(urlparse(body["cursor_deeplink"]).query)
    config = json.loads(base64.b64decode(qs["config"][0]))
    assert config == {"url": body["mcp_url"]}


def test_oauth_register_cursor_web_callback(client):
    """Cursor desktop DCR sends https://www.cursor.com/agents/mcp/oauth/callback."""
    reg = client.post(
        "/api/v1/oauth/register",
        json={
            "client_name": "Cursor",
            "redirect_uris": [
                "cursor://anysphere.cursor-mcp/oauth/callback",
                "https://www.cursor.com/agents/mcp/oauth/callback",
                "http://localhost:8787/callback",
            ],
            "token_endpoint_auth_method": "none",
        },
    )
    assert reg.status_code == 201
    body = reg.json()
    assert "https://www.cursor.com/agents/mcp/oauth/callback" in body["redirect_uris"]
    assert "client_secret" not in body
    assert "client_secret_expires_at" not in body


def test_oauth_register_rejects_unknown_redirect(client):
    reg = client.post(
        "/api/v1/oauth/register",
        json={
            "client_name": "Evil",
            "redirect_uris": ["https://evil.com/callback"],
            "token_endpoint_auth_method": "none",
        },
    )
    assert reg.status_code == 400
    body = reg.json()
    assert body["error"] == "invalid_client_metadata"
    assert "error_description" in body


def test_oauth_register_and_token_exchange(client, db, owner):
    user_headers = auth_headers(client, owner.email)
    verifier, challenge = _pkce_pair()
    reg = client.post(
        "/api/v1/oauth/register",
        json={
            "client_name": "Test Cursor",
            "redirect_uris": ["cursor://anysphere.cursor-mcp/oauth/callback"],
            "token_endpoint_auth_method": "none",
        },
    )
    assert reg.status_code == 201
    client_id = reg.json()["client_id"]
    redirect_uri = "cursor://anysphere.cursor-mcp/oauth/callback"

    auth = client.get(
        "/api/v1/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": "test-state",
            "scope": "profile:read tasks:read search:read projects:read organizations:read",
        },
        follow_redirects=False,
    )
    assert auth.status_code == 302
    assert "/oauth/mcp" in auth.headers["location"]
    request_id = parse_qs(urlparse(auth.headers["location"]).query)["request_id"][0]

    approve = client.post(
        "/api/v1/oauth/mcp/approve",
        headers=user_headers,
        json={"request_id": request_id},
    )
    assert approve.status_code == 200
    redirect_to = approve.json()["redirect_to"]
    assert redirect_to.startswith(redirect_uri)
    code = redirect_to.split("code=")[1].split("&")[0]

    token = client.post(
        "/api/v1/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
        },
    )
    assert token.status_code == 200
    access = token.json()["access_token"]
    assert access.startswith("fd_live_")

    introspect = client.post("/api/v1/oauth/introspect", data={"token": access})
    assert introspect.status_code == 200
    assert introspect.json()["active"] is True

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["user"]["id"] == str(owner.id)
