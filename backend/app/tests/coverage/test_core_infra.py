"""Phase 6 — realtime bus and health edge cases."""
import pytest

from app.core.health import build_health_payload
from app.core.realtime_bus import RealtimeBus


@pytest.mark.coverage
def test_realtime_bus_disabled_without_redis_url():
    bus = RealtimeBus("")
    assert bus.enabled is False
    assert bus.ping() is False
    assert bus.publish(["room"], {"type": "ping"}) is False


@pytest.mark.coverage
def test_cors_origins_include_frontend_and_extras(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("FRONTEND_URL", "https://flowdesk.brightcone.ai")
    monkeypatch.setenv("BACKEND_URL", "https://flowdesk-api-mvwt.onrender.com")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://u:p@localhost:5432/flowdesk")
    monkeypatch.setenv("MICROSOFT_TENANT", "common")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("CORS_ORIGINS", "https://flowdesk-ui.onrender.com,https://staging.example.com")
    from app.core.config import get_settings

    get_settings.cache_clear()
    origins = get_settings().cors_origins
    get_settings.cache_clear()
    assert origins == [
        "https://flowdesk.brightcone.ai",
        "https://flowdesk-ui.onrender.com",
        "https://staging.example.com",
    ]


@pytest.mark.coverage
def test_health_payload_ok_without_redis():
    payload = build_health_payload()
    assert payload["status"] == "ok"
    assert payload["redis"]["configured"] is False


@pytest.mark.coverage
def test_health_payload_degraded_when_redis_unreachable(monkeypatch):
    class _Bus:
        enabled = True

    monkeypatch.setattr("app.core.health.get_realtime_bus", lambda: _Bus())
    monkeypatch.setattr("app.core.health.redis_ping", lambda: False)

    payload = build_health_payload()
    assert payload["status"] == "degraded"
    assert payload["redis"]["reachable"] is False
