import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # Empty by default — callers must explicitly select scopes (consent).
    scopes: list[str] = Field(default_factory=list, max_length=40)
    # None = no expiry (allowed). Default 90 days when omitted.
    expires_in_days: int | None = Field(default=90, ge=1, le=365)


class ApiTokenRotate(BaseModel):
    scopes: list[str] | None = Field(default=None, max_length=40)


class ApiTokenRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ApiTokenOut(ORMModel):
    id: uuid.UUID
    name: str
    token_prefix: str
    scopes: list[str]
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None
    revoke_at: datetime | None = None
    created_at: datetime
    display_suffix: str | None = None
    environment: str | None = None
    public_key_id: str | None = None
    rotated_from_id: uuid.UUID | None = None


class ApiTokenCreatedOut(ApiTokenOut):
    """Returned once on create/rotate — includes the raw token."""

    token: str


class ApiScopeOut(BaseModel):
    scope: str
    group: str
    name: str
    description: str
    access: str


class ApiRateLimitOut(BaseModel):
    category: str
    limit: int
    window_seconds: int
    algorithm: str = "fixed_window"


class ApiPublicRouteOut(BaseModel):
    methods: list[str]
    path: str
    scopes: list[str]
    rate_category: str
    authz_class: str
    tenant_resolution: str = ""


class ApiTokenMetaOut(BaseModel):
    """Safe public metadata for the API Keys UI and developer docs (no secrets)."""

    scopes: list[ApiScopeOut]
    max_lifetime_days: int
    rotation_grace_seconds: int
    resource_restrictions_supported: bool = False
    identity_model: str = "user_bound"
    api_version: str = "1.0.0"
    base_path: str = "/api/v1"
    rate_limits: list[ApiRateLimitOut] = Field(default_factory=list)
    public_routes: list[ApiPublicRouteOut] = Field(default_factory=list)


class ApiTokenActivityOut(BaseModel):
    at: str
    event: str
    detail: str | None = None


class ApiTokenUsageOut(BaseModel):
    token_id: uuid.UUID
    window: str = "24h"
    requests_24h: int = 0
    errors_24h: int = 0
    rate_limited_24h: int = 0
    top_endpoint: str | None = None
    last_used_at: datetime | None = None
    last_success_at: str | None = None
    last_success_route: str | None = None
    last_fail_at: str | None = None
    last_fail_route: str | None = None
    last_fail_status: int | None = None
    last_ip: str | None = None
    status: str
    metrics_available: bool = True
    activity: list[ApiTokenActivityOut] = Field(default_factory=list)
