"""Regression tests for public form spam controls (issue #33)."""
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.services.captcha_service import captcha_required, verify_turnstile


def test_captcha_disabled_without_secret():
    with patch("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", ""):
        assert captcha_required() is False
        verify_turnstile(None, "127.0.0.1")  # no-op


def test_captcha_required_rejects_missing_token():
    with patch("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", "test-secret"):
        with pytest.raises(HTTPException) as exc:
            verify_turnstile(None, "127.0.0.1")
        assert exc.value.status_code == 422


@patch("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", "test-secret")
@patch("app.services.captcha_service.httpx.Client")
def test_captcha_rejects_failed_verification(mock_client_cls):
    mock_response = mock_client_cls.return_value.__enter__.return_value.post.return_value
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"success": False}

    with pytest.raises(HTTPException) as exc:
        verify_turnstile("bad-token", "127.0.0.1")
    assert exc.value.status_code == 422


@patch("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", "test-secret")
@patch("app.services.captcha_service.httpx.Client")
def test_captcha_accepts_successful_verification(mock_client_cls):
    mock_response = mock_client_cls.return_value.__enter__.return_value.post.return_value
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"success": True}

    verify_turnstile("good-token", "127.0.0.1")
