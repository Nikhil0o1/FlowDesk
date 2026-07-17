import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin


class McpToolInvocation(Base, UUIDPkMixin, TimestampMixin):
    """Audit trail for MCP tool calls (via PAT / OAuth-issued tokens)."""

    __tablename__ = "mcp_tool_invocations"
    __table_args__ = (
        Index("ix_mcp_audit_user_created", "user_id", "created_at"),
        Index("ix_mcp_audit_token_created", "token_id", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("personal_access_tokens.id", ondelete="SET NULL"), nullable=True
    )
    tool: Mapped[str] = mapped_column(String(120), nullable=False)
    args_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    http_status: Mapped[int | None] = mapped_column(Integer)
    resource_ids: Mapped[list[str]] = mapped_column(ARRAY(String(64)), nullable=False, default=list)
    error_message: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
