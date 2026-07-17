"""Unit tests for MCP sidecar reverse proxy."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.mcp_proxy import mount_mcp_proxy


@pytest.fixture
def proxy_app():
    app = FastAPI()
    mount_mcp_proxy(app)
    return app


def test_mcp_proxy_post_success(proxy_app):
    client = TestClient(proxy_app)
    mock_response = httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", "http://test/mcp"))

    with patch("app.core.mcp_proxy.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = None
        mock_client.request = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_client

        res = client.post("/mcp", json={"jsonrpc": "2.0", "method": "ping"})
        assert res.status_code == 200
        assert res.json() == {"ok": True}


def test_mcp_proxy_sidecar_unavailable(proxy_app):
    client = TestClient(proxy_app)
    with patch("app.core.mcp_proxy.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = None
        mock_client.request = AsyncMock(side_effect=httpx.ConnectError("refused"))
        mock_client_cls.return_value = mock_client

        res = client.post("/mcp", json={})
        assert res.status_code == 503
