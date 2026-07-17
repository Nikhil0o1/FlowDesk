"""Phase 4 security — GitHub webhook signature enforcement."""
import hashlib
import hmac

import pytest


def _sign(payload: bytes, secret: str) -> str:
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


@pytest.mark.security
def test_github_webhook_rejects_invalid_signature(client, monkeypatch):
    monkeypatch.setattr("app.services.github_service.settings.GITHUB_WEBHOOK_SECRET", "webhook-secret")
    monkeypatch.setattr("app.services.github_service.settings.ENVIRONMENT", "production")

    response = client.post(
        "/api/v1/github/webhook",
        content=b'{"zen":"test"}',
        headers={
            "X-Hub-Signature-256": "sha256=deadbeef",
            "X-GitHub-Event": "ping",
        },
    )
    assert response.status_code == 401


@pytest.mark.security
def test_github_webhook_accepts_valid_signature(client, monkeypatch):
    monkeypatch.setattr("app.services.github_service.settings.GITHUB_WEBHOOK_SECRET", "webhook-secret")
    monkeypatch.setattr("app.services.github_service.settings.ENVIRONMENT", "production")
    payload = b'{"zen":"test"}'

    response = client.post(
        "/api/v1/github/webhook",
        content=payload,
        headers={
            "X-Hub-Signature-256": _sign(payload, "webhook-secret"),
            "X-GitHub-Event": "ping",
        },
    )
    assert response.status_code == 200
    assert response.json().get("ok") is True
