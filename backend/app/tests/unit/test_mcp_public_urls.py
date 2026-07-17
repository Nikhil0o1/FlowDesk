"""MCP public URL resolution — production must never advertise loopback."""

import pytest

from app.core.config import Settings


def _settings(**overrides) -> Settings:
    base = {
        "ENVIRONMENT": "production",
        "DEBUG": False,
        "SECRET_KEY": "test-secret-key",
        "FRONTEND_URL": "http://localhost:5173",
        "BACKEND_URL": "https://flowdesk-api-mvwt.onrender.com",
        "DATABASE_URL": "postgresql+psycopg2://u:p@db.example.com/flowdesk",
        "MICROSOFT_TENANT": "common",
        "STORAGE_BACKEND": "local",
        "GITHUB_WEBHOOK_SECRET": "whsec_test",
    }
    base.update(overrides)
    return Settings(**base)


def test_mcp_public_url_ignores_loopback_override_in_production():
    cfg = _settings(MCP_PUBLIC_URL="http://localhost:3100")
    assert cfg.mcp_public_url == "https://flowdesk-api-mvwt.onrender.com/mcp"


def test_mcp_public_url_defaults_to_backend_in_production():
    cfg = _settings(MCP_PUBLIC_URL="")
    assert cfg.mcp_public_url == "https://flowdesk-api-mvwt.onrender.com/mcp"


def test_public_frontend_url_uses_canonical_when_misconfigured():
    cfg = _settings(FRONTEND_URL="http://localhost:5173")
    assert cfg.public_frontend_url == "https://flowdesk.brightcone.ai"


def test_colocated_enabled_when_loopback_override_in_production():
    """A stale localhost MCP_PUBLIC_URL must not disable the /mcp proxy in prod."""
    cfg = _settings(MCP_PUBLIC_URL="http://localhost:3100")
    assert cfg.mcp_colocated_enabled is True


def test_colocated_enabled_when_override_matches_public_backend():
    cfg = _settings(
        BACKEND_URL="http://localhost:8000",
        MCP_PUBLIC_URL="https://flowdesk-api-mvwt.onrender.com/mcp",
    )
    assert cfg.mcp_colocated_enabled is True


def test_colocated_disabled_for_separate_mcp_host_in_production():
    cfg = _settings(MCP_PUBLIC_URL="https://mcp.brightcone.ai")
    assert cfg.mcp_colocated_enabled is False


def test_mcp_public_url_uses_local_sidecar_in_dev():
    cfg = _settings(
        ENVIRONMENT="development",
        DEBUG=True,
        FRONTEND_URL="http://localhost:5173",
        BACKEND_URL="http://localhost:8000",
        DATABASE_URL="postgresql+psycopg2://flowdesk:flowdesk@localhost:5432/flowdesk",
        GITHUB_WEBHOOK_SECRET="",
    )
    assert cfg.mcp_public_url == "http://localhost:3100/mcp"
