"""OAuth clients and authorization codes for MCP (Cursor, Claude, etc.)."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin


class McpOAuthClient(Base, UUIDPkMixin, TimestampMixin):
    """Dynamically registered OAuth client (e.g. Cursor on first connect)."""

    __tablename__ = "mcp_oauth_clients"
    __table_args__ = (Index("ix_mcp_oauth_clients_client_id", "client_id", unique=True),)

    client_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    client_secret_hash: Mapped[str | None] = mapped_column(String(128))
    client_name: Mapped[str] = mapped_column(String(200), nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    token_endpoint_auth_method: Mapped[str] = mapped_column(String(40), nullable=False, default="none")
    client_id_issued_at: Mapped[int | None] = mapped_column()
    client_secret_expires_at: Mapped[int | None] = mapped_column()


class McpOAuthAuthorizationRequest(Base, UUIDPkMixin, TimestampMixin):
    """Pending authorization (PKCE) before the user approves in the FlowDesk UI."""

    __tablename__ = "mcp_oauth_authorization_requests"
    __table_args__ = (Index("ix_mcp_oauth_auth_req_expires", "expires_at"),)

    client_id: Mapped[str] = mapped_column(String(64), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    code_challenge: Mapped[str] = mapped_column(String(128), nullable=False)
    state: Mapped[str | None] = mapped_column(String(512))
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    resource: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class McpOAuthAuthorizationCode(Base, UUIDPkMixin, TimestampMixin):
    """Short-lived authorization code exchanged for a PAT access token."""

    __tablename__ = "mcp_oauth_authorization_codes"
    __table_args__ = (
        Index("ix_mcp_oauth_code_hash", "code_hash", unique=True),
        Index("ix_mcp_oauth_code_expires", "expires_at"),
    )

    code_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    client_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    code_challenge: Mapped[str] = mapped_column(String(128), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    resource: Mapped[str | None] = mapped_column(Text)
    pat_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("personal_access_tokens.id", ondelete="SET NULL")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
