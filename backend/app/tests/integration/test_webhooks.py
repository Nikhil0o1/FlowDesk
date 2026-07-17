"""Integration tests for outbound webhook management and delivery."""
from __future__ import annotations

import json
import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest

from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.webhook import (
    WEBHOOK_SECRET_PREFIX,
    WebhookDelivery,
    WebhookEndpoint,
)
from app.services import webhook_service
from app.services.token_vault import seal
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack

pytestmark = pytest.mark.integration


@pytest.fixture
def allow_private_webhook_urls(monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_ALLOW_PRIVATE_URLS", True)
    yield


def _create_endpoint(client, org_id, headers, *, url="http://127.0.0.1:9999/hook", events=None):
    return client.post(
        f"/api/v1/organizations/{org_id}/webhooks",
        json={
            "url": url,
            "events": events or ["task.created", "task.updated"],
            "description": "Test hook",
        },
        headers=headers,
    )


@pytest.mark.coverage
def test_webhook_crud_lifecycle(client, db, org, owner, allow_private_webhook_urls):
    headers = auth_headers(client, owner.email)
    create = _create_endpoint(client, org.id, headers)
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["url"] == "http://127.0.0.1:9999/hook"
    assert body["secret"].startswith("whsec_")
    assert body["secret_prefix"]
    assert "disabled_reason" in body
    endpoint_id = body["id"]

    listed = client.get(f"/api/v1/organizations/{org.id}/webhooks", headers=headers)
    assert listed.status_code == 200
    assert any(item["id"] == endpoint_id for item in listed.json())

    fetched = client.get(
        f"/api/v1/organizations/{org.id}/webhooks/{endpoint_id}", headers=headers
    )
    assert fetched.status_code == 200
    assert fetched.json()["description"] == "Test hook"

    updated = client.patch(
        f"/api/v1/organizations/{org.id}/webhooks/{endpoint_id}",
        json={"description": "Updated hook", "is_active": False},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["description"] == "Updated hook"
    assert updated.json()["is_active"] is False
    assert updated.json()["disabled_reason"] == "manual"

    rotated = client.post(
        f"/api/v1/organizations/{org.id}/webhooks/{endpoint_id}/rotate-secret",
        headers=headers,
    )
    assert rotated.status_code == 200
    assert rotated.json()["secret"].startswith("whsec_")
    assert rotated.json()["secret"] != body["secret"]
    assert rotated.json()["previous_secret_expires_at"] is not None

    deleted = client.delete(
        f"/api/v1/organizations/{org.id}/webhooks/{endpoint_id}", headers=headers
    )
    assert deleted.status_code == 200
    assert client.get(
        f"/api/v1/organizations/{org.id}/webhooks/{endpoint_id}", headers=headers
    ).status_code == 404

    audits = db.scalars(
        select(AuditLog).where(
            AuditLog.organization_id == org.id,
            AuditLog.action.like("webhook.endpoint.%"),
        )
    ).all()
    actions = {a.action for a in audits}
    assert "webhook.endpoint.created" in actions
    assert "webhook.endpoint.secret_rotated" in actions
    assert "webhook.endpoint.deleted" in actions


@pytest.mark.coverage
def test_non_admin_cannot_manage_webhooks(client, db, org, owner, allow_private_webhook_urls):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "member@test.dev")
    headers = auth_headers(client, member.email)

    blocked = _create_endpoint(client, org.id, headers)
    assert blocked.status_code == 403


@pytest.mark.coverage
def test_reject_private_webhook_url(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    create = _create_endpoint(client, org.id, headers, url="http://127.0.0.1/hook")
    assert create.status_code == 400
    assert "private" in create.json()["detail"].lower() or "loopback" in create.json()["detail"].lower()


@pytest.mark.coverage
@patch("app.services.webhook_service.requests.post")
def test_test_ping_records_delivery(mock_post, client, db, org, owner, allow_private_webhook_urls):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = '{"ok":true}'
    mock_post.return_value = mock_response

    headers = auth_headers(client, owner.email)
    create = _create_endpoint(client, org.id, headers)
    endpoint_id = create.json()["id"]
    secret = create.json()["secret"]

    result = client.post(
        f"/api/v1/organizations/{org.id}/webhooks/{endpoint_id}/test", headers=headers
    )
    assert result.status_code == 200
    assert result.json()["success"] is True
    assert result.json()["response_status"] == 200

    deliveries = client.get(
        f"/api/v1/organizations/{org.id}/webhooks/{endpoint_id}/deliveries",
        headers=headers,
    )
    assert deliveries.status_code == 200
    items = deliveries.json()["items"]
    assert len(items) >= 1
    assert items[0]["event_type"] == "ping"
    assert items[0]["status"] == "success"
    assert items[0]["max_attempts"] >= 1
    assert items[0]["api_version"]

    call_kwargs = mock_post.call_args.kwargs
    headers_sent = call_kwargs["headers"]
    assert headers_sent["X-FlowDesk-Event"] == "ping"
    assert headers_sent["X-FlowDesk-Signature"].startswith("t=")
    assert "v1=" in headers_sent["X-FlowDesk-Signature"]
    assert headers_sent["X-FlowDesk-Timestamp"]
    assert headers_sent["X-FlowDesk-Idempotency-Key"]

    # Verify signature against raw body
    body = call_kwargs["data"]
    ts = headers_sent["X-FlowDesk-Timestamp"]
    expected = webhook_service.sign_v1(ts, body if isinstance(body, bytes) else body.encode(), secret)
    assert f"v1={expected}" in headers_sent["X-FlowDesk-Signature"]


@pytest.mark.coverage
@patch("celery_app.tasks.webhooks.deliver_webhook.delay")
def test_task_create_enqueues_webhook(
    mock_delay, client, db, org, owner, allow_private_webhook_urls
):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create_hook = _create_endpoint(
        client, org.id, headers, events=["task.created"]
    )
    assert create_hook.status_code == 201

    task = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        json={"title": "Webhook task"},
        headers=headers,
    )
    assert task.status_code == 201, task.text
    assert mock_delay.called


@pytest.mark.coverage
def test_hmac_signature_verification(db, org, owner, allow_private_webhook_urls):
    raw_secret = webhook_service.generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(raw_secret),
        secret_prefix=raw_secret[: len(WEBHOOK_SECRET_PREFIX) + 4],
        events=["*"],
    )
    db.add(endpoint)
    db.flush()

    payload = webhook_service.build_payload("task.created", {"task_id": str(uuid.uuid4())})
    body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
    ts = 1710000000
    signature = webhook_service.sign_v1(ts, body, raw_secret)
    expected = webhook_service.sign_v1(ts, body, raw_secret)
    assert signature == expected
    assert len(signature) == 64
    header = webhook_service.build_signature_header(ts, body, [raw_secret])
    assert header == f"t={ts},v1={signature}"


@pytest.mark.coverage
@patch("app.services.webhook_service.requests.post")
def test_auto_disable_after_failures(mock_post, db, org, owner, allow_private_webhook_urls, monkeypatch):
    mock_post.side_effect = __import__("requests").RequestException("connection refused")
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_AUTO_DISABLE_THRESHOLD", 3)

    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(webhook_service.generate_secret()),
        secret_prefix="whsec_abcd",
        events=["task.created"],
        is_active=True,
    )
    db.add(endpoint)
    db.flush()

    # One logical failure per delivery when max_attempts=1
    for _ in range(3):
        delivery = WebhookDelivery(
            endpoint_id=endpoint.id,
            event_type="task.created",
            idempotency_key=uuid.uuid4(),
            status="pending",
            request_payload=webhook_service.build_payload("task.created", {"task_id": "x"}),
            max_attempts=1,
        )
        db.add(delivery)
        db.commit()
        webhook_service.perform_delivery(db, endpoint.id, delivery.id, 1)

    db.refresh(endpoint)
    assert endpoint.is_active is False
    assert endpoint.disabled_at is not None
    assert endpoint.disabled_reason == "auto_failures"
    assert endpoint.failure_count >= 3

    audits = db.scalars(
        select(AuditLog).where(
            AuditLog.action == "webhook.endpoint.auto_disabled",
            AuditLog.target_id == str(endpoint.id),
        )
    ).all()
    assert len(audits) >= 1


@pytest.mark.coverage
@patch("celery_app.tasks.webhooks.deliver_webhook.delay")
def test_redeliver_creates_new_delivery(
    mock_delay, client, db, org, owner, allow_private_webhook_urls
):
    headers = auth_headers(client, owner.email)
    create = _create_endpoint(client, org.id, headers)
    endpoint_id = create.json()["id"]

    endpoint = db.get(WebhookEndpoint, uuid.UUID(endpoint_id))
    source = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="task.created",
        idempotency_key=uuid.uuid4(),
        status="failed",
        request_payload=webhook_service.build_payload("task.created", {"task_id": "x"}),
        max_attempts=6,
        error_message="HTTP 500",
    )
    db.add(source)
    db.commit()

    result = client.post(
        f"/api/v1/organizations/{org.id}/webhooks/{endpoint_id}/deliveries/{source.id}/redeliver",
        headers=headers,
    )
    assert result.status_code == 201, result.text
    body = result.json()
    assert body["status"] == "pending"
    assert body["redelivered_from_id"] == str(source.id)
    assert body["id"] != str(source.id)
    assert mock_delay.called


@pytest.mark.coverage
@patch("celery_app.tasks.webhooks.deliver_webhook.delay")
def test_reconcile_stale_pending(mock_delay, db, org, owner, allow_private_webhook_urls, monkeypatch):
    monkeypatch.setattr("app.services.webhook_service.settings.WEBHOOK_RECONCILE_STALE_MINUTES", 1)

    endpoint = WebhookEndpoint(
        organization_id=org.id,
        created_by=owner.id,
        url="http://127.0.0.1:9999/hook",
        secret_encrypted=seal(webhook_service.generate_secret()),
        secret_prefix="whsec_abcd",
        events=["*"],
        is_active=True,
    )
    db.add(endpoint)
    db.flush()
    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="task.created",
        idempotency_key=uuid.uuid4(),
        status="pending",
        request_payload=webhook_service.build_payload("task.created", {}),
        max_attempts=6,
    )
    db.add(delivery)
    db.flush()
    delivery.updated_at = webhook_service._now() - timedelta(minutes=30)
    db.commit()

    count = webhook_service.reconcile_stale_deliveries(db)
    assert count == 1
    assert mock_delay.called
