"""Phase 2 unit tests — CAPTCHA service."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.services import captcha_service


@pytest.mark.unit
def test_captcha_disabled_without_secret(monkeypatch):
    monkeypatch.setattr("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", "")
    assert captcha_service.captcha_required() is False
    captcha_service.verify_turnstile(None)


@pytest.mark.unit
def test_captcha_required_rejects_missing_token(monkeypatch):
    monkeypatch.setattr("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", "secret")
    with pytest.raises(HTTPException) as exc:
        captcha_service.verify_turnstile(None)
    assert exc.value.status_code == 422


@pytest.mark.unit
@patch("app.services.captcha_service.httpx.Client")
def test_captcha_rejects_failed_verification(mock_client_cls, monkeypatch):
    monkeypatch.setattr("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", "secret")
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"success": False}
    mock_resp.raise_for_status = MagicMock()
    mock_client_cls.return_value.__enter__.return_value.post.return_value = mock_resp

    with pytest.raises(HTTPException) as exc:
        captcha_service.verify_turnstile("bad-token")
    assert exc.value.status_code == 422


@pytest.mark.unit
@patch("app.services.captcha_service.httpx.Client")
def test_captcha_accepts_success(mock_client_cls, monkeypatch):
    monkeypatch.setattr("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", "secret")
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"success": True}
    mock_resp.raise_for_status = MagicMock()
    mock_client_cls.return_value.__enter__.return_value.post.return_value = mock_resp

    captcha_service.verify_turnstile("good-token")
