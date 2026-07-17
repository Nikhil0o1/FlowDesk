"""Outbound webhook subscriptions and delivery audit log.

An organization admin registers an endpoint URL + event filter. When a matching
event happens anywhere in the org, a signed JSON POST is delivered via Celery
with retries. The HMAC signing secret is stored Fernet-encrypted (token_vault) —
unlike PAT hashes, the raw secret is needed at delivery time to sign payloads.
It is surfaced to the admin only once, at creation/rotation.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin

WEBHOOK_SECRET_PREFIX = "whsec_"

# Delivery statuses
DELIVERY_PENDING = "pending"
DELIVERY_RETRYING = "retrying"
DELIVERY_SUCCESS = "success"
DELIVERY_FAILED = "failed"

# Endpoint disable reasons
DISABLED_MANUAL = "manual"
DISABLED_AUTO_FAILURES = "auto_failures"

DEFAULT_MAX_ATTEMPTS = 6  # initial + 5 Celery retries


class WebhookEndpoint(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "webhook_endpoints"
    __table_args__ = (
        Index("ix_webhook_endpoints_org_active", "organization_id", "is_active"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    secret_encrypted: Mapped[str] = mapped_column(String(512), nullable=False)
    secret_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    # Previous secret kept during rotation grace so dual-sign works for mid-rotation receivers.
    previous_secret_encrypted: Mapped[str | None] = mapped_column(String(512))
    previous_secret_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Event names like "task.created"; ["*"] subscribes to everything.
    events: Mapped[list[str]] = mapped_column(ARRAY(String(80)), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    failure_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disabled_reason: Mapped[str | None] = mapped_column(String(32))
    last_delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookDelivery(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "webhook_deliveries"
    __table_args__ = (
        Index("ix_webhook_deliveries_endpoint_created", "endpoint_id", "created_at"),
        Index("ix_webhook_deliveries_idempotency", "idempotency_key"),
        Index("ix_webhook_deliveries_status_updated", "status", "updated_at"),
    )

    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    idempotency_key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=DELIVERY_PENDING, nullable=False)
    request_payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    response_status: Mapped[int | None] = mapped_column(Integer)
    response_body: Mapped[str | None] = mapped_column(Text)  # truncated to 4 KB
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=DEFAULT_MAX_ATTEMPTS, nullable=False)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    api_version: Mapped[str] = mapped_column(String(32), default="2026-07-14", nullable=False)
    redelivered_from_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("webhook_deliveries.id", ondelete="SET NULL")
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
