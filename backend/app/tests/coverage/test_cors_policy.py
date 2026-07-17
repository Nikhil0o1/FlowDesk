"""Tests for production CORS policy."""
import pytest

from app.core.config import get_settings
from app.core.cors_policy import cors_origin_regex, origin_allowed


@pytest.mark.coverage
def test_origin_allowed_explicit_and_regex(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("FRONTEND_URL", "https://flowdesk.brightcone.ai")
    monkeypatch.setenv("BACKEND_URL", "https://flowdesk-api-mvwt.onrender.com")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://u:p@localhost:5432/flowdesk")
    monkeypatch.setenv("MICROSOFT_TENANT", "common")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "whsec_test")
    get_settings.cache_clear()
    cfg = get_settings()

    assert origin_allowed(cfg, "https://flowdesk.brightcone.ai")
    assert origin_allowed(cfg, "https://flowdesk-ui.onrender.com")
    assert origin_allowed(cfg, "https://app.brightcone.ai")
    assert not origin_allowed(cfg, "https://evil.example.com")
    assert cors_origin_regex(cfg) is not None
    get_settings.cache_clear()


@pytest.mark.coverage
def test_trusted_hosts_include_backend_hostname(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("FRONTEND_URL", "https://flowdesk.brightcone.ai")
    monkeypatch.setenv("BACKEND_URL", "https://flowdesk-api-mvwt.onrender.com")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://u:p@localhost:5432/flowdesk")
    monkeypatch.setenv("MICROSOFT_TENANT", "common")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("TRUSTED_HOSTS", "")
    get_settings.cache_clear()
    hosts = get_settings().trusted_host_list
    get_settings.cache_clear()
    assert "flowdesk-api-mvwt.onrender.com" in hosts


@pytest.mark.coverage
def test_trusted_hosts_include_loopback_when_mcp_sidecar(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("FRONTEND_URL", "https://flowdesk.brightcone.ai")
    monkeypatch.setenv("BACKEND_URL", "https://flowdesk-api-mvwt.onrender.com")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://u:p@localhost:5432/flowdesk")
    monkeypatch.setenv("MICROSOFT_TENANT", "common")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("TRUSTED_HOSTS", "flowdesk-api-mvwt.onrender.com")
    monkeypatch.setenv("MCP_SIDECAR_ENABLED", "true")
    get_settings.cache_clear()
    hosts = get_settings().trusted_host_list
    get_settings.cache_clear()
    assert "127.0.0.1" in hosts
    assert "localhost" in hosts
