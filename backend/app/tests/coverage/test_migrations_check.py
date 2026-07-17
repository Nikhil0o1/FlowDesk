"""Coverage — auto-upgrade pending migrations in development."""
from unittest.mock import patch

import pytest

from app.core import migrations_check


@pytest.mark.coverage
@patch("app.core.migrations_check.subprocess.check_call")
@patch("app.core.migrations_check.migration_status")
def test_ensure_migrations_auto_upgrades_in_development(mock_status, mock_upgrade, monkeypatch):
    monkeypatch.setattr("app.core.migrations_check.settings.ENVIRONMENT", "development")
    mock_status.side_effect = [("old-rev", "head-rev"), ("head-rev", "head-rev")]

    migrations_check.ensure_migrations_current()

    mock_upgrade.assert_called_once()
    assert mock_status.call_count == 2


@pytest.mark.coverage
@patch("app.core.migrations_check.migration_status")
def test_ensure_migrations_raises_in_production_when_behind(mock_status, monkeypatch):
    monkeypatch.setattr("app.core.migrations_check.settings.ENVIRONMENT", "production")
    mock_status.return_value = ("old-rev", "head-rev")

    with pytest.raises(RuntimeError, match="out of date"):
        migrations_check.ensure_migrations_current()


@pytest.mark.coverage
@patch("app.core.migrations_check.subprocess.check_call")
@patch("app.core.migrations_check.migration_status")
def test_ensure_migrations_raises_when_auto_upgrade_fails(mock_status, mock_upgrade, monkeypatch):
    monkeypatch.setattr("app.core.migrations_check.settings.ENVIRONMENT", "development")
    mock_status.side_effect = [("old-rev", "head-rev"), ("still-old", "head-rev")]

    with pytest.raises(RuntimeError, match="auto-upgrade failed"):
        migrations_check.ensure_migrations_current()

    mock_upgrade.assert_called_once()
