"""Coverage — lifecycle startup/shutdown with mocked dependencies."""
from unittest.mock import MagicMock, patch

import pytest

from app.core import lifecycle


@pytest.mark.coverage
@patch("app.core.lifecycle.ensure_migrations_current")
def test_validate_runtime_config_warns_celery_without_redis(mock_migrations, monkeypatch):
    monkeypatch.setattr("app.core.lifecycle.settings.ENVIRONMENT", "development")
    monkeypatch.setattr("app.core.lifecycle.settings.REDIS_URL", "")

    lifecycle.validate_runtime_config()
    mock_migrations.assert_called_once()


@pytest.mark.coverage
@patch("app.core.lifecycle.get_realtime_bus")
def test_start_realtime_bus_skips_when_disabled(mock_get_bus):
    bus = MagicMock()
    bus.enabled = False
    mock_get_bus.return_value = bus

    lifecycle.start_realtime_bus()
    bus.ping.assert_not_called()


@pytest.mark.coverage
@patch("app.core.lifecycle.manager")
@patch("app.core.lifecycle.get_realtime_bus")
def test_start_realtime_bus_starts_listener(mock_get_bus, mock_manager):
    bus = MagicMock()
    bus.enabled = True
    bus.ping.return_value = True
    mock_get_bus.return_value = bus

    lifecycle.start_realtime_bus()
    bus.start_listener.assert_called_once()
    handler = bus.start_listener.call_args[0][0]
    handler(["workspace:1"], {"type": "task.updated"})
    mock_manager.broadcast_sync.assert_called_once_with(["workspace:1"], {"type": "task.updated"})


@pytest.mark.coverage
@patch("app.core.lifecycle.get_realtime_bus")
def test_stop_services_stops_bus(mock_get_bus):
    bus = MagicMock()
    mock_get_bus.return_value = bus
    lifecycle.stop_services(scheduler=None)
    bus.stop_listener.assert_called_once()
