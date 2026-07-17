"""Phase 2 unit tests — GitHub webhook signature verification."""
import hashlib
import hmac

import pytest

from app.services.github_service import verify_signature


def _sign(payload: bytes, secret: str) -> str:
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


@pytest.mark.unit
def test_verify_signature_valid(monkeypatch):
    monkeypatch.setattr("app.services.github_service.settings.GITHUB_WEBHOOK_SECRET", "webhook-secret")
    monkeypatch.setattr("app.services.github_service.settings.ENVIRONMENT", "development")
    payload = b'{"action":"opened"}'
    assert verify_signature(payload, _sign(payload, "webhook-secret")) is True


@pytest.mark.unit
def test_verify_signature_rejects_tampered_payload(monkeypatch):
    monkeypatch.setattr("app.services.github_service.settings.GITHUB_WEBHOOK_SECRET", "webhook-secret")
    payload = b'{"action":"opened"}'
    assert verify_signature(payload, _sign(b'{"action":"closed"}', "webhook-secret")) is False


@pytest.mark.unit
def test_verify_signature_rejects_missing_header(monkeypatch):
    monkeypatch.setattr("app.services.github_service.settings.GITHUB_WEBHOOK_SECRET", "webhook-secret")
    assert verify_signature(b"{}", None) is False
    assert verify_signature(b"{}", "sha1=deadbeef") is False


@pytest.mark.unit
def test_verify_signature_fail_closed_in_production_without_secret(monkeypatch):
    monkeypatch.setattr("app.services.github_service.settings.GITHUB_WEBHOOK_SECRET", "")
    monkeypatch.setattr("app.services.github_service.settings.ENVIRONMENT", "production")
    assert verify_signature(b"{}", "sha256=abc") is False


@pytest.mark.unit
def test_verify_signature_allows_unsigned_in_dev_without_secret(monkeypatch):
    monkeypatch.setattr("app.services.github_service.settings.GITHUB_WEBHOOK_SECRET", "")
    monkeypatch.setattr("app.services.github_service.settings.ENVIRONMENT", "development")
    assert verify_signature(b"{}", None) is True
