"""Schemas for integration OAuth apps (ClickUp-style Custom Apps)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


def _normalize_redirect_uris(uris: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in uris:
        uri = (raw or "").strip()
        if not uri or uri in seen:
            continue
        if not (uri.startswith("https://") or uri.startswith("http://localhost") or uri.startswith("http://127.0.0.1")):
            raise ValueError(
                f"redirect_uri must be https:// or http://localhost / http://127.0.0.1: {uri}"
            )
        seen.add(uri)
        out.append(uri)
    if not out:
        raise ValueError("At least one redirect_uri is required")
    if len(out) > 20:
        raise ValueError("Maximum of 20 redirect URIs")
    return out


class IntegrationOAuthAppCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    redirect_uris: list[str] = Field(min_length=1)
    default_scopes: list[str] | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("name is required")
        return s

    @field_validator("redirect_uris")
    @classmethod
    def validate_redirects(cls, v: list[str]) -> list[str]:
        return _normalize_redirect_uris(v)


class IntegrationOAuthAppUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    redirect_uris: list[str] | None = None
    default_scopes: list[str] | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            raise ValueError("name cannot be empty")
        return s

    @field_validator("redirect_uris")
    @classmethod
    def validate_redirects(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        return _normalize_redirect_uris(v)


class IntegrationOAuthAppOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    client_id: str
    redirect_uris: list[str]
    default_scopes: list[str]
    display_suffix: str
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None = None

    model_config = {"from_attributes": True}


class IntegrationOAuthAppCreatedOut(IntegrationOAuthAppOut):
    """Returned once at create / regenerate — includes plaintext client_secret."""

    client_secret: str
    env_snippet: str
    authorize_url_template: str
    token_url: str


class IntegrationOAuthAuthRequestOut(BaseModel):
    request_id: uuid.UUID
    client_name: str
    client_id: str
    organization_id: uuid.UUID | None = None
    scopes: list[str]
    redirect_uri: str


class IntegrationOAuthApproveIn(BaseModel):
    request_id: uuid.UUID


class IntegrationOAuthApproveOut(BaseModel):
    redirect_to: str


class IntegrationOAuthTokenIn(BaseModel):
    client_id: str
    client_secret: str
    code: str


class IntegrationOAuthAuthorizedAppOut(BaseModel):
    """An OAuth app the current user has connected (authorized) — shown under API tokens → Custom Apps."""

    app_id: uuid.UUID
    name: str
    client_id: str
    organization_id: uuid.UUID
    workspace_count: int = 1
    authorized_at: datetime
    scopes: list[str]
    pat_id: uuid.UUID
