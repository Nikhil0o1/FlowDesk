"""Health payload tests for MCP sidecar status."""

from unittest.mock import MagicMock, patch

import httpx

from app.core.health import _mcp_sidecar_status, build_health_payload


def test_mcp_sidecar_status_disabled():
    with patch("app.core.health.settings.MCP_SIDECAR_ENABLED", False):
        assert _mcp_sidecar_status() is None


def test_mcp_sidecar_status_ok():
    with patch("app.core.health.settings.MCP_SIDECAR_ENABLED", True), patch(
        "app.core.health.httpx.get"
    ) as mock_get:
        mock_get.return_value = MagicMock(status_code=200)
        assert _mcp_sidecar_status() == "ok"


def test_mcp_sidecar_status_unavailable():
    with patch("app.core.health.settings.MCP_SIDECAR_ENABLED", True), patch(
        "app.core.health.httpx.get", side_effect=httpx.ConnectError("down")
    ):
        assert _mcp_sidecar_status() == "unavailable"


def test_build_health_payload_mcp_degraded():
    with patch("app.core.health.settings.MCP_SIDECAR_ENABLED", True), patch(
        "app.core.health._mcp_sidecar_status", return_value="unavailable"
    ):
        payload = build_health_payload()
        assert payload["status"] == "degraded"
        assert payload["mcp_sidecar"] == "unavailable"
