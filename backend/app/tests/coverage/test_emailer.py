"""Coverage — emailer backend selection and async dispatch."""
from unittest.mock import MagicMock, patch

import pytest

from app.core import emailer


@pytest.mark.coverage
def test_get_email_backend_console_when_disabled(monkeypatch):
    monkeypatch.setattr("app.core.emailer.settings.EMAIL_USERNAME", "")
    backend = emailer.get_email_backend()
    assert isinstance(backend, emailer.ConsoleBackend)


@pytest.mark.coverage
def test_get_email_backend_smtp_when_configured(monkeypatch):
    monkeypatch.setattr("app.core.emailer.settings.EMAIL_USERNAME", "smtp-user")
    backend = emailer.get_email_backend()
    assert isinstance(backend, emailer.SMTPBackend)


@pytest.mark.coverage
@patch("app.core.emailer.get_email_backend")
@patch("app.core.emailer._executor.submit")
def test_send_email_async_dispatches(mock_submit, mock_backend, monkeypatch):
    backend = MagicMock()
    mock_backend.return_value = backend

    emailer.send_email_async("user@test.dev", "Hello", "<p>Hi</p>", "Hi")
    mock_submit.assert_called_once()
    mock_submit.call_args[0][0]()
    backend.send.assert_called_once_with("user@test.dev", "Hello", "<p>Hi</p>", "Hi")


@pytest.mark.coverage
def test_console_backend_logs_without_error(caplog):
    backend = emailer.ConsoleBackend()
    with caplog.at_level("INFO"):
        backend.send("dev@test.dev", "Subject", "<p>body</p>")
    assert "dev@test.dev" in caplog.text
