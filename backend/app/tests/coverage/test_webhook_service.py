"""Unit tests for webhook_service helpers."""
from __future__ import annotations

import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest

from app.models.webhook import (
    DELIVERY_FAILED,
    DELIVERY_RETRYING,
    DELIVERY_SUCCESS,
    WebhookDelivery,
    WebhookEndpoint,
)
from app.services import webhook_service
from app.services.token_vault import seal
from app.services.webhook_service import (
    WebhookUrlError,
    build_payload,
    build_signature_header,
    sign_v1,
    validate_webhook_url,
)

pytestmark = pytest.mark.coverage


def test_build_payload_envelope():
    key = uuid.uuid4()
    payload = build_payload("task.created", {"task_id": "abc"}, key)
    assert payload["event"] == "task.created"
    assert payload["api_version"]
    assert payload["idempotency_key"] == str(key)
    assert payload["data"]["task_id"] == "abc"
    assert payload["timestamp"].endswith("+00:00") or "T" in payload["timestamp"]


def test_sign_v1_deterministic():
    body = b'{"event":"ping"}'
    a = sign_v1(1710000000, body, "whsec_testsecret")
    b = sign_v1(1710000000, body, "whsec_testsecret")
    assert a == b
    assert a != sign_v1(1710000000, body, "whsec_other")
    assert a != sign_v1(1710000001, body, "whsec_testsecret")


def test_build_signature_header_multi_v1():
    body = b'{"event":"ping"}'
    header = build_signature_header(1710000000, body, ["whsec_a", "whsec_b"])
    assert header.startswith("t=1710000000,")
    assert header.count("v1=") == 2


def test_validate_webhook_url_rejects_private_ip():
    with pytest.raises(WebhookUrlError, match="private|loopback"):
        validate_webhook_url("http://127.0.0.1/hook")


def test_validate_webhook_url_rejects_credentials():
    with pytest.raises(WebhookUrlError, match="credentials"):
        validate_webhook_url("http://user:pass@example.com/hook")


@patch("app.services.webhook_service.socket.getaddrinfo")
def test_validate_webhook_url_rejects_private_dns(mock_getaddrinfo):
    mock_getaddrinfo.return_value = [(None, None, None, None, ("10.0.0.1", 443))]
    with pytest.raises(WebhookUrlError, match="private|loopback"):
        validate_webhook_url("http://example.com/hook")


def test_validate_webhook_url_allows_private_when_flag_set(monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)
    validate_webhook_url("http://127.0.0.1/hook")


def test_response_body_truncation_in_delivery(db, org, owner, monkeypatch):
    """perform_delivery truncates response bodies to 4 KB."""
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)

    raw = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(raw),
        secret_prefix=raw[:12],
        events=["ping"],
    )
    db.add(endpoint)
    db.flush()
    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="ping",
        idempotency_key=uuid.uuid4(),
        status="pending",
        request_payload=build_payload("ping", {}),
        max_attempts=6,
    )
    db.add(delivery)
    db.flush()

    long_body = "x" * 5000
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = long_body

    with patch("app.services.webhook_service.requests.post", return_value=mock_response):
        webhook_service.perform_delivery(db, endpoint.id, delivery.id, 1)

    db.refresh(delivery)
    assert delivery.response_body is not None
    assert len(delivery.response_body) <= 4096
    assert delivery.status == DELIVERY_SUCCESS


def test_transient_failure_marks_retrying_without_failure_count(db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_MAX_ATTEMPTS", 6)

    raw = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(raw),
        secret_prefix=raw[:12],
        events=["*"],
        failure_count=0,
    )
    db.add(endpoint)
    db.flush()
    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="task.created",
        idempotency_key=uuid.uuid4(),
        status="pending",
        request_payload=build_payload("task.created", {}),
        max_attempts=6,
    )
    db.add(delivery)
    db.commit()

    with patch(
        "app.services.webhook_service.requests.post",
        side_effect=__import__("requests").RequestException("boom"),
    ):
        with pytest.raises(webhook_service.RetryableDeliveryError):
            webhook_service.perform_delivery(db, endpoint.id, delivery.id, 1)

    db.refresh(delivery)
    db.refresh(endpoint)
    assert delivery.status == DELIVERY_RETRYING
    assert endpoint.failure_count == 0
    assert delivery.next_retry_at is not None


def test_exhausted_retries_increment_failure_once(db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)

    raw = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(raw),
        secret_prefix=raw[:12],
        events=["*"],
        failure_count=0,
    )
    db.add(endpoint)
    db.flush()
    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="task.created",
        idempotency_key=uuid.uuid4(),
        status="pending",
        request_payload=build_payload("task.created", {}),
        max_attempts=2,
    )
    db.add(delivery)
    db.commit()

    with patch(
        "app.services.webhook_service.requests.post",
        side_effect=__import__("requests").RequestException("boom"),
    ):
        with pytest.raises(webhook_service.RetryableDeliveryError):
            webhook_service.perform_delivery(db, endpoint.id, delivery.id, 1)
        webhook_service.perform_delivery(db, endpoint.id, delivery.id, 2)

    db.refresh(delivery)
    db.refresh(endpoint)
    assert delivery.status == DELIVERY_FAILED
    assert endpoint.failure_count == 1


def test_dual_sign_during_secret_grace(db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_SECRET_GRACE_SECONDS", 86400)

    old_secret = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(old_secret),
        secret_prefix=old_secret[:12],
        events=["*"],
    )
    db.add(endpoint)
    db.flush()
    new_secret = webhook_service.rotate_secret(db, endpoint)
    db.commit()

    secrets = webhook_service._signing_secrets(endpoint)
    assert len(secrets) == 2
    assert secrets[0] == new_secret
    assert secrets[1] == old_secret

    body = b'{"event":"ping"}'
    header = build_signature_header(1710000000, body, secrets)
    assert header.count("v1=") == 2


def test_purge_old_deliveries(db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_DELIVERY_RETENTION_DAYS", 1)
    raw = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(raw),
        secret_prefix=raw[:12],
        events=["*"],
    )
    db.add(endpoint)
    db.flush()
    old = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="ping",
        idempotency_key=uuid.uuid4(),
        status=DELIVERY_SUCCESS,
        request_payload=build_payload("ping", {}),
    )
    db.add(old)
    db.flush()
    # Force created_at into the past
    old.created_at = webhook_service._now() - timedelta(days=5)
    db.commit()

    deleted = webhook_service.purge_old_deliveries(db)
    db.commit()
    assert deleted >= 1
    assert db.get(WebhookDelivery, old.id) is None


def test_enable_endpoint_clears_failure_state(db, org, owner):
    raw = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(raw),
        secret_prefix=raw[:12],
        events=["*"],
        is_active=False,
        failure_count=5,
        disabled_at=webhook_service._now(),
        disabled_reason="auto",
    )
    db.add(endpoint)
    db.flush()
    webhook_service.enable_endpoint(db, endpoint)
    assert endpoint.is_active is True
    assert endpoint.failure_count == 0
    assert endpoint.disabled_at is None


def test_perform_delivery_disabled_and_missing_secret(db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(webhook_service.generate_secret()),
        secret_prefix="whsec_xxxx",
        events=["*"],
        is_active=False,
    )
    db.add(endpoint)
    db.flush()
    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="ping",
        idempotency_key=uuid.uuid4(),
        status="pending",
        request_payload=build_payload("ping", {}),
        max_attempts=3,
    )
    db.add(delivery)
    db.commit()

    webhook_service.perform_delivery(db, endpoint.id, delivery.id, 1)
    db.refresh(delivery)
    assert delivery.status == DELIVERY_FAILED
    assert "disabled" in (delivery.error_message or "").lower()

    # Missing delivery / endpoint is a no-op
    webhook_service.perform_delivery(db, uuid.uuid4(), uuid.uuid4(), 1)

    endpoint.is_active = True
    endpoint.secret_encrypted = "not-a-valid-sealed-blob"
    delivery2 = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="ping",
        idempotency_key=uuid.uuid4(),
        status="pending",
        request_payload=build_payload("ping", {}),
        max_attempts=1,
    )
    db.add(delivery2)
    db.commit()
    with patch.object(webhook_service, "_signing_secrets", return_value=[]):
        webhook_service.perform_delivery(db, endpoint.id, delivery2.id, 1)
    db.refresh(delivery2)
    assert delivery2.status == DELIVERY_FAILED


def test_perform_delivery_permanent_4xx(db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)
    raw = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(raw),
        secret_prefix=raw[:12],
        events=["*"],
        failure_count=0,
    )
    db.add(endpoint)
    db.flush()
    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="ping",
        idempotency_key=uuid.uuid4(),
        status="pending",
        request_payload=build_payload("ping", {}),
        max_attempts=3,
    )
    db.add(delivery)
    db.commit()

    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.text = "bad request"
    with patch("app.services.webhook_service.requests.post", return_value=mock_response):
        webhook_service.perform_delivery(db, endpoint.id, delivery.id, 1)
    db.refresh(delivery)
    db.refresh(endpoint)
    assert delivery.status == DELIVERY_FAILED
    assert endpoint.failure_count == 1


def test_enqueue_workspace_event_missing_workspace(db):
    assert webhook_service.enqueue_workspace_event(db, uuid.uuid4(), "task.created", {}) == 0


def test_send_test_ping_request_error(db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)
    raw = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(raw),
        secret_prefix=raw[:12],
        events=["*"],
    )
    db.add(endpoint)
    db.commit()

    with patch(
        "app.services.webhook_service.requests.post",
        side_effect=__import__("requests").RequestException("timeout"),
    ):
        result = webhook_service.send_test_ping(db, endpoint)
    assert result["success"] is False
    assert "timeout" in result["error"]
