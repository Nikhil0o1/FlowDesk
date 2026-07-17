import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

# Canonical outbound event catalog. "*" subscribes to everything.
VALID_EVENTS = (
    "task.created",
    "task.updated",
    "task.deleted",
    "task.assigned",
    "status.changed",
    "comment.added",
    "project.created",
    "project.updated",
    "project.archived",
    "sprint.started",
    "sprint.completed",
    "*",
)

VALID_DELIVERY_STATUSES = ("pending", "retrying", "success", "failed")


def _validate_events(events: list[str]) -> list[str]:
    cleaned = [e.strip() for e in events if e.strip()]
    if not cleaned:
        raise ValueError("At least one event is required")
    invalid = [e for e in cleaned if e not in VALID_EVENTS]
    if invalid:
        raise ValueError(f"Unknown event(s): {', '.join(invalid)}")
    if "*" in cleaned:
        return ["*"]
    return list(dict.fromkeys(cleaned))


class WebhookEndpointCreate(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    events: list[str] = Field(min_length=1, max_length=20)
    description: str | None = Field(default=None, max_length=255)

    @field_validator("events")
    @classmethod
    def check_events(cls, v: list[str]) -> list[str]:
        return _validate_events(v)


class WebhookEndpointUpdate(BaseModel):
    url: str | None = Field(default=None, min_length=1, max_length=2048)
    events: list[str] | None = Field(default=None, min_length=1, max_length=20)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None

    @field_validator("events")
    @classmethod
    def check_events(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        return _validate_events(v)


class WebhookEndpointOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    url: str
    description: str | None = None
    secret_prefix: str
    events: list[str]
    is_active: bool
    failure_count: int
    disabled_at: datetime | None = None
    disabled_reason: str | None = None
    previous_secret_expires_at: datetime | None = None
    last_delivered_at: datetime | None = None
    created_at: datetime


class WebhookEndpointCreatedOut(WebhookEndpointOut):
    """Returned once on create/rotate — includes the raw signing secret."""

    secret: str


class WebhookDeliveryOut(ORMModel):
    id: uuid.UUID
    endpoint_id: uuid.UUID
    event_type: str
    idempotency_key: uuid.UUID
    status: str
    request_payload: dict
    response_status: int | None = None
    response_body: str | None = None
    duration_ms: int | None = None
    attempt: int
    max_attempts: int
    next_retry_at: datetime | None = None
    api_version: str
    redelivered_from_id: uuid.UUID | None = None
    error_message: str | None = None
    delivered_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class WebhookTestOut(BaseModel):
    success: bool
    response_status: int | None = None
    duration_ms: int | None = None
    error: str | None = None
