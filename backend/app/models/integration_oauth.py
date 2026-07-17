"""OAuth apps for third-party integrations (Holocron / Brightcone) — ClickUp-style."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin

CLIENT_ID_PREFIX = "fd_app_"


class IntegrationOAuthApp(Base, UUIDPkMixin, TimestampMixin):
    """Org-owned OAuth application (client_id + peppered client_secret)."""

    __tablename__ = "integration_oauth_apps"
    __table_args__ = (
        Index("ix_integration_oauth_apps_client_id", "client_id", unique=True),
        Index("ix_integration_oauth_apps_org", "organization_id", "revoked_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    client_id: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    # Public id fragment for secret format fd_appsec_<kid>_<secret> (optional display)
    secret_public_id: Mapped[str] = mapped_column(String(32), nullable=False)
    secret_digest: Mapped[str] = mapped_column(String(128), nullable=False)
    hash_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    pepper_version: Mapped[int] = mapped_column(Integer, nullable=False)
    display_suffix: Mapped[str] = mapped_column(String(8), nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    default_scopes: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class IntegrationOAuthAuthRequest(Base, UUIDPkMixin, TimestampMixin):
    """Pending authorization before the user approves in the FlowDesk UI (no PKCE — ClickUp-shaped)."""

    __tablename__ = "integration_oauth_auth_requests"
    __table_args__ = (Index("ix_integration_oauth_auth_req_expires", "expires_at"),)

    client_id: Mapped[str] = mapped_column(String(80), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str | None] = mapped_column(String(512))
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class IntegrationOAuthAuthCode(Base, UUIDPkMixin, TimestampMixin):
    """Short-lived authorization code exchanged for a user-bound access token."""

    __tablename__ = "integration_oauth_auth_codes"
    __table_args__ = (
        Index("ix_integration_oauth_code_hash", "code_hash", unique=True),
        Index("ix_integration_oauth_code_expires", "expires_at"),
    )

    code_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    client_id: Mapped[str] = mapped_column(String(80), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    pat_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("personal_access_tokens.id", ondelete="SET NULL")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
