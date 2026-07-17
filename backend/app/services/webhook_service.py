"""Outbound webhook lifecycle: endpoint CRUD, event fan-out, signed delivery.

Flow:
  1. Business code calls enqueue_event(db, org_id, event_type, data) AFTER commit.
  2. Matching active endpoints get a pending WebhookDelivery row each, and a
     Celery task (flowdesk.deliver_webhook) is enqueued per endpoint.
  3. The worker POSTs the signed JSON payload. Transient failures mark the
     delivery as retrying (failure_count unchanged). Permanent failures or
     exhausted retries mark failed and increment failure_count once.

Security:
  - Stripe-style HMAC-SHA256 over `{timestamp}.{body}` (X-FlowDesk-Signature).
  - Dual-sign with previous secret during rotation grace window.
  - Signing secret is Fernet-encrypted at rest, revealed once at creation.
  - SSRF guard: URL must be http(s), must not resolve to private/loopback
    address space (unless WEBHOOK_ALLOW_PRIVATE_URLS for local dev), and must
    be HTTPS in production.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import math
import secrets
import socket
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import requests
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.organization import OrganizationMember
from app.models.user import User
from app.models.webhook import (
    DEFAULT_MAX_ATTEMPTS,
    DELIVERY_FAILED,
    DELIVERY_PENDING,
    DELIVERY_RETRYING,
    DELIVERY_SUCCESS,
    DISABLED_AUTO_FAILURES,
    DISABLED_MANUAL,
    WEBHOOK_SECRET_PREFIX,
    WebhookDelivery,
    WebhookEndpoint,
)
from app.services.audit_service import audit
from app.services.notification_service import notify
from app.services.token_vault import reveal, seal

logger = logging.getLogger(__name__)

RESPONSE_BODY_MAX_CHARS = 4096
USER_AGENT = "FlowDesk-Webhook/1.0"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- URL safety


class WebhookUrlError(ValueError):
    """Raised when a webhook target URL is not allowed."""


def _is_private_address(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def validate_webhook_url(url: str) -> None:
    """Reject URLs that could be used for SSRF against internal infrastructure."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise WebhookUrlError("URL must use http or https")
    if settings.is_production and parsed.scheme != "https":
        raise WebhookUrlError("URL must use https in production")
    host = parsed.hostname
    if not host:
        raise WebhookUrlError("URL must include a hostname")
    if parsed.username or parsed.password:
        raise WebhookUrlError("URL must not embed credentials")

    if settings.WEBHOOK_ALLOW_PRIVATE_URLS:
        return

    if host.lower() in ("localhost",) or _is_private_address(host):
        raise WebhookUrlError("URL must not target private or loopback addresses")
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise WebhookUrlError("URL hostname could not be resolved") from exc
    for info in infos:
        addr = info[4][0]
        if _is_private_address(addr):
            raise WebhookUrlError("URL resolves to a private or loopback address")


# ------------------------------------------------------------- endpoint CRUD


def generate_secret() -> str:
    return f"{WEBHOOK_SECRET_PREFIX}{secrets.token_urlsafe(32)}"


def create_endpoint(
    db: Session,
    *,
    organization_id: uuid.UUID,
    created_by: uuid.UUID,
    url: str,
    events: list[str],
    description: str | None = None,
) -> tuple[str, WebhookEndpoint]:
    validate_webhook_url(url)
    active_count = len(
        db.scalars(
            select(WebhookEndpoint.id).where(
                WebhookEndpoint.organization_id == organization_id
            )
        ).all()
    )
    if active_count >= settings.WEBHOOK_MAX_PER_ORG:
        raise ValueError(
            f"Maximum of {settings.WEBHOOK_MAX_PER_ORG} webhook endpoints per organization"
        )

    raw_secret = generate_secret()
    endpoint = WebhookEndpoint(
        organization_id=organization_id,
        created_by=created_by,
        url=url.strip(),
        description=(description or "").strip() or None,
        secret_encrypted=seal(raw_secret),
        secret_prefix=raw_secret[: len(WEBHOOK_SECRET_PREFIX) + 4],
        events=events,
    )
    db.add(endpoint)
    db.flush()
    return raw_secret, endpoint


def rotate_secret(db: Session, endpoint: WebhookEndpoint) -> str:
    """Rotate signing secret; keep previous sealed secret for dual-sign grace."""
    previous = endpoint.secret_encrypted
    raw_secret = generate_secret()
    endpoint.previous_secret_encrypted = previous
    endpoint.previous_secret_expires_at = _now() + timedelta(
        seconds=settings.WEBHOOK_SECRET_GRACE_SECONDS
    )
    endpoint.secret_encrypted = seal(raw_secret)
    endpoint.secret_prefix = raw_secret[: len(WEBHOOK_SECRET_PREFIX) + 4]
    db.flush()
    return raw_secret


def enable_endpoint(db: Session, endpoint: WebhookEndpoint) -> None:
    """Re-enable a disabled endpoint and clear failure accounting."""
    endpoint.is_active = True
    endpoint.failure_count = 0
    endpoint.disabled_at = None
    endpoint.disabled_reason = None


def disable_endpoint_manual(db: Session, endpoint: WebhookEndpoint) -> None:
    endpoint.is_active = False
    endpoint.disabled_at = _now()
    endpoint.disabled_reason = DISABLED_MANUAL


def get_org_endpoint_or_none(
    db: Session, organization_id: uuid.UUID, endpoint_id: uuid.UUID
) -> WebhookEndpoint | None:
    endpoint = db.get(WebhookEndpoint, endpoint_id)
    if endpoint is None or endpoint.organization_id != organization_id:
        return None
    return endpoint


# ----------------------------------------------------------- payload/signing


def build_payload(
    event_type: str, data: dict, idempotency_key: uuid.UUID | None = None
) -> dict:
    return {
        "event": event_type,
        "api_version": settings.WEBHOOK_API_VERSION,
        "timestamp": _now().isoformat(),
        "idempotency_key": str(idempotency_key or uuid.uuid4()),
        "data": data,
    }


def sign_v1(timestamp: int | str, body: bytes, secret: str) -> str:
    """HMAC-SHA256 of `{timestamp}.{body}` — Stripe-style v1 signature."""
    signed = f"{timestamp}.".encode("utf-8") + body
    return hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()


def build_signature_header(
    timestamp: int, body: bytes, secrets_list: list[str]
) -> str:
    """Build `t=<ts>,v1=<sig>[,v1=<sig>]` with one or more secrets (rotation grace)."""
    parts = [f"t={timestamp}"]
    for secret in secrets_list:
        parts.append(f"v1={sign_v1(timestamp, body, secret)}")
    return ",".join(parts)


def _signing_secrets(endpoint: WebhookEndpoint) -> list[str]:
    """Current secret plus previous secret if still within grace window."""
    current = reveal(endpoint.secret_encrypted)
    if not current:
        return []
    secrets_list = [current]
    if (
        endpoint.previous_secret_encrypted
        and endpoint.previous_secret_expires_at
        and endpoint.previous_secret_expires_at > _now()
    ):
        previous = reveal(endpoint.previous_secret_encrypted)
        if previous:
            secrets_list.append(previous)
    return secrets_list


def _serialize_body(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")


def _delivery_headers(
    *,
    event_type: str,
    delivery_id: uuid.UUID,
    idempotency_key: uuid.UUID,
    body: bytes,
    secrets_list: list[str],
    timestamp: int | None = None,
) -> dict[str, str]:
    ts = timestamp if timestamp is not None else int(_now().timestamp())
    return {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-FlowDesk-Event": event_type,
        "X-FlowDesk-Timestamp": str(ts),
        "X-FlowDesk-Signature": build_signature_header(ts, body, secrets_list),
        "X-FlowDesk-Delivery": str(delivery_id),
        "X-FlowDesk-Idempotency-Key": str(idempotency_key),
    }


# ------------------------------------------------------------------ dispatch


def _matches(endpoint: WebhookEndpoint, event_type: str) -> bool:
    return "*" in endpoint.events or event_type in endpoint.events


def enqueue_event(
    db: Session, organization_id: uuid.UUID, event_type: str, data: dict
) -> int:
    """Fan an event out to all matching active endpoints. Call after commit.

    Creates one pending delivery row per endpoint and enqueues a Celery task
    each. Returns the number of deliveries enqueued. Never raises — webhook
    dispatch must not break the calling request.
    """
    try:
        endpoints = db.scalars(
            select(WebhookEndpoint).where(
                WebhookEndpoint.organization_id == organization_id,
                WebhookEndpoint.is_active.is_(True),
            )
        ).all()
        targets = [e for e in endpoints if _matches(e, event_type)]
        if not targets:
            return 0

        idempotency_key = uuid.uuid4()
        payload = build_payload(event_type, data, idempotency_key)
        pending: list[tuple[uuid.UUID, uuid.UUID]] = []
        for endpoint in targets:
            delivery = WebhookDelivery(
                endpoint_id=endpoint.id,
                event_type=event_type,
                idempotency_key=idempotency_key,
                status=DELIVERY_PENDING,
                request_payload=payload,
                max_attempts=settings.WEBHOOK_MAX_ATTEMPTS,
                api_version=settings.WEBHOOK_API_VERSION,
            )
            db.add(delivery)
            db.flush()
            pending.append((endpoint.id, delivery.id))
        db.commit()
        for endpoint_id, delivery_id in pending:
            _enqueue_delivery_task(endpoint_id, delivery_id)
        return len(pending)
    except Exception:
        logger.exception("Webhook enqueue failed for event %s (org %s)", event_type, organization_id)
        try:
            db.rollback()
        except Exception:
            pass
        return 0


def enqueue_workspace_event(
    db: Session, workspace_id: uuid.UUID, event_type: str, data: dict
) -> int:
    """Resolve the owning organization from a workspace, then fan out."""
    from app.models.workspace import Workspace

    ws = db.get(Workspace, workspace_id)
    if ws is None:
        return 0
    return enqueue_event(db, ws.organization_id, event_type, data)


def enqueue_delivery_task(endpoint_id: uuid.UUID, delivery_id: uuid.UUID) -> None:
    """Enqueue Celery delivery for an existing delivery row."""
    from celery_app.tasks.webhooks import deliver_webhook

    deliver_webhook.delay(str(endpoint_id), str(delivery_id))


# Back-compat alias used inside this module
_enqueue_delivery_task = enqueue_delivery_task


# ------------------------------------------------------------------ delivery


class RetryableDeliveryError(Exception):
    """Network error or 5xx — Celery should retry."""


def _backoff_seconds(attempt: int) -> int:
    """Approximate Celery exponential backoff (capped at 600s)."""
    return min(600, int(math.pow(2, max(0, attempt - 1))))


def _is_transient_http(status_code: int) -> bool:
    return status_code >= 500 or status_code == 429


def perform_delivery(
    db: Session,
    endpoint_id: uuid.UUID,
    delivery_id: uuid.UUID,
    attempt: int,
) -> None:
    """Execute one delivery attempt and record the outcome.

    Transient failures set status=retrying and raise RetryableDeliveryError
    without incrementing failure_count. Permanent failures or exhausted retries
    set status=failed and call _record_failure once.
    """
    endpoint = db.get(WebhookEndpoint, endpoint_id)
    delivery = db.get(WebhookDelivery, delivery_id)
    if endpoint is None or delivery is None:
        return

    max_attempts = delivery.max_attempts or settings.WEBHOOK_MAX_ATTEMPTS
    delivery.attempt = attempt
    delivery.next_retry_at = None

    if not endpoint.is_active:
        delivery.status = DELIVERY_FAILED
        delivery.error_message = "Endpoint is disabled"
        db.commit()
        return

    secrets_list = _signing_secrets(endpoint)
    if not secrets_list:
        delivery.status = DELIVERY_FAILED
        delivery.error_message = (
            "Signing secret unavailable (SECRET_KEY rotated?) — rotate the webhook secret"
        )
        _record_failure(db, endpoint)
        db.commit()
        return

    try:
        validate_webhook_url(endpoint.url)
    except WebhookUrlError as exc:
        delivery.status = DELIVERY_FAILED
        delivery.error_message = f"URL rejected: {exc}"
        _record_failure(db, endpoint)
        db.commit()
        return

    body = _serialize_body(delivery.request_payload)
    headers = _delivery_headers(
        event_type=delivery.event_type,
        delivery_id=delivery.id,
        idempotency_key=delivery.idempotency_key,
        body=body,
        secrets_list=secrets_list,
    )

    started = _now()
    try:
        response = requests.post(
            endpoint.url,
            data=body,
            headers=headers,
            timeout=settings.WEBHOOK_DELIVERY_TIMEOUT_SECONDS,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        delivery.duration_ms = int((_now() - started).total_seconds() * 1000)
        delivery.error_message = str(exc)[:500]
        _mark_transient_or_exhausted(db, endpoint, delivery, attempt, max_attempts)
        db.commit()
        if delivery.status == DELIVERY_RETRYING:
            raise RetryableDeliveryError(str(exc)) from exc
        return

    delivery.duration_ms = int((_now() - started).total_seconds() * 1000)
    delivery.response_status = response.status_code
    delivery.response_body = (response.text or "")[:RESPONSE_BODY_MAX_CHARS]

    if 200 <= response.status_code < 300:
        delivery.status = DELIVERY_SUCCESS
        delivery.delivered_at = _now()
        delivery.error_message = None
        delivery.next_retry_at = None
        endpoint.failure_count = 0
        endpoint.last_delivered_at = _now()
        db.commit()
        return

    delivery.error_message = f"HTTP {response.status_code}"
    if _is_transient_http(response.status_code):
        _mark_transient_or_exhausted(db, endpoint, delivery, attempt, max_attempts)
        db.commit()
        if delivery.status == DELIVERY_RETRYING:
            raise RetryableDeliveryError(f"HTTP {response.status_code}")
        return

    # Permanent client error (4xx except 429)
    delivery.status = DELIVERY_FAILED
    delivery.next_retry_at = None
    _record_failure(db, endpoint)
    db.commit()


def _mark_transient_or_exhausted(
    db: Session,
    endpoint: WebhookEndpoint,
    delivery: WebhookDelivery,
    attempt: int,
    max_attempts: int,
) -> None:
    if attempt < max_attempts:
        delivery.status = DELIVERY_RETRYING
        delivery.next_retry_at = _now() + timedelta(seconds=_backoff_seconds(attempt))
        return
    delivery.status = DELIVERY_FAILED
    delivery.next_retry_at = None
    _record_failure(db, endpoint)


def _record_failure(db: Session, endpoint: WebhookEndpoint) -> None:
    """Increment failure_count once per logical delivery failure; auto-disable at threshold."""
    endpoint.failure_count += 1
    if endpoint.failure_count >= settings.WEBHOOK_AUTO_DISABLE_THRESHOLD and endpoint.is_active:
        endpoint.is_active = False
        endpoint.disabled_at = _now()
        endpoint.disabled_reason = DISABLED_AUTO_FAILURES
        logger.warning(
            "Webhook endpoint %s auto-disabled after %s consecutive failures",
            endpoint.id,
            endpoint.failure_count,
        )
        audit(
            db,
            "webhook.endpoint.auto_disabled",
            organization_id=endpoint.organization_id,
            actor_id=None,
            target_type="webhook_endpoint",
            target_id=endpoint.id,
            data={
                "url": endpoint.url,
                "failure_count": endpoint.failure_count,
                "reason": DISABLED_AUTO_FAILURES,
            },
        )
        _notify_admins_auto_disabled(db, endpoint)


def _notify_admins_auto_disabled(db: Session, endpoint: WebhookEndpoint) -> None:
    members = db.scalars(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == endpoint.organization_id,
            OrganizationMember.role.in_(("owner", "admin")),
        )
    ).all()
    title = "Webhook endpoint auto-disabled"
    body = (
        f"Endpoint {endpoint.url} was disabled after "
        f"{endpoint.failure_count} consecutive delivery failures."
    )
    data = {
        "endpoint_id": str(endpoint.id),
        "url": endpoint.url,
        "failure_count": endpoint.failure_count,
    }
    settings_url = f"{settings.FRONTEND_URL}/app/settings?tab=webhooks"
    for member in members:
        try:
            notify(
                db,
                member.user_id,
                "webhook_endpoint_disabled",
                title,
                body,
                data=data,
            )
        except Exception:
            logger.exception("Failed to notify user %s of webhook auto-disable", member.user_id)
        user = db.get(User, member.user_id)
        if user and user.email:
            try:
                from app.services import email_service

                email_service.send_webhook_disabled_email(
                    user.email,
                    endpoint_url=endpoint.url,
                    failure_count=endpoint.failure_count,
                    settings_url=settings_url,
                )
            except Exception:
                logger.exception("Failed to email %s about webhook auto-disable", user.email)


# ---------------------------------------------------------------- redeliver


def redeliver_delivery(
    db: Session, endpoint: WebhookEndpoint, source: WebhookDelivery
) -> WebhookDelivery:
    """Create a new pending delivery cloned from a failed/pending/retrying one."""
    if source.endpoint_id != endpoint.id:
        raise ValueError("Delivery does not belong to this endpoint")
    if source.status == DELIVERY_SUCCESS:
        raise ValueError("Successful deliveries cannot be redelivered")

    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type=source.event_type,
        idempotency_key=uuid.uuid4(),
        status=DELIVERY_PENDING,
        request_payload=source.request_payload,
        max_attempts=settings.WEBHOOK_MAX_ATTEMPTS,
        api_version=settings.WEBHOOK_API_VERSION,
        redelivered_from_id=source.id,
    )
    db.add(delivery)
    db.flush()
    return delivery


# --------------------------------------------------------- ops / maintenance


def reconcile_stale_deliveries(db: Session) -> int:
    """Re-enqueue pending/retrying deliveries that appear stuck (broker crash safety)."""
    stale_before = _now() - timedelta(minutes=settings.WEBHOOK_RECONCILE_STALE_MINUTES)
    rows = db.scalars(
        select(WebhookDelivery).where(
            WebhookDelivery.status.in_((DELIVERY_PENDING, DELIVERY_RETRYING)),
            WebhookDelivery.updated_at < stale_before,
            or_(
                WebhookDelivery.next_retry_at.is_(None),
                WebhookDelivery.next_retry_at <= _now(),
            ),
        ).limit(200)
    ).all()
    count = 0
    for delivery in rows:
        endpoint = db.get(WebhookEndpoint, delivery.endpoint_id)
        if endpoint is None or not endpoint.is_active:
            continue
        if delivery.attempt >= (delivery.max_attempts or settings.WEBHOOK_MAX_ATTEMPTS):
            continue
        try:
            _enqueue_delivery_task(delivery.endpoint_id, delivery.id)
            count += 1
        except Exception:
            logger.exception("Failed to re-enqueue stale delivery %s", delivery.id)
    return count


def purge_old_deliveries(db: Session) -> int:
    """Delete webhook_deliveries older than retention window."""
    cutoff = _now() - timedelta(days=settings.WEBHOOK_DELIVERY_RETENTION_DAYS)
    result = db.execute(
        delete(WebhookDelivery).where(WebhookDelivery.created_at < cutoff)
    )
    return int(result.rowcount or 0)


# ---------------------------------------------------------------- test ping


def send_test_ping(db: Session, endpoint: WebhookEndpoint) -> dict:
    """Synchronous ping delivery so admins can verify their endpoint works."""
    payload = build_payload(
        "ping",
        {
            "message": "FlowDesk webhook test",
            "endpoint_id": str(endpoint.id),
            "organization_id": str(endpoint.organization_id),
        },
    )
    delivery = WebhookDelivery(
        endpoint_id=endpoint.id,
        event_type="ping",
        idempotency_key=uuid.UUID(payload["idempotency_key"]),
        status=DELIVERY_PENDING,
        request_payload=payload,
        max_attempts=1,
        api_version=settings.WEBHOOK_API_VERSION,
    )
    db.add(delivery)
    db.flush()

    secrets_list = _signing_secrets(endpoint)
    if not secrets_list:
        delivery.status = DELIVERY_FAILED
        delivery.error_message = "Signing secret unavailable — rotate the webhook secret"
        db.commit()
        return {"success": False, "error": delivery.error_message}

    body = _serialize_body(payload)
    headers = _delivery_headers(
        event_type="ping",
        delivery_id=delivery.id,
        idempotency_key=delivery.idempotency_key,
        body=body,
        secrets_list=secrets_list,
    )
    started = _now()
    try:
        response = requests.post(
            endpoint.url,
            data=body,
            headers=headers,
            timeout=settings.WEBHOOK_DELIVERY_TIMEOUT_SECONDS,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        delivery.status = DELIVERY_FAILED
        delivery.error_message = str(exc)[:500]
        delivery.duration_ms = int((_now() - started).total_seconds() * 1000)
        db.commit()
        return {
            "success": False,
            "duration_ms": delivery.duration_ms,
            "error": delivery.error_message,
        }

    delivery.duration_ms = int((_now() - started).total_seconds() * 1000)
    delivery.response_status = response.status_code
    delivery.response_body = (response.text or "")[:RESPONSE_BODY_MAX_CHARS]
    success = 200 <= response.status_code < 300
    delivery.status = DELIVERY_SUCCESS if success else DELIVERY_FAILED
    if success:
        delivery.delivered_at = _now()
        endpoint.last_delivered_at = _now()
    db.commit()
    return {
        "success": success,
        "response_status": response.status_code,
        "duration_ms": delivery.duration_ms,
    }
