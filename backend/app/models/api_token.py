import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin

PAT_PREFIX = "fd_pat_"
PAT_LIVE_PREFIX = "fd_live_"


class PersonalAccessToken(Base, UUIDPkMixin, TimestampMixin):
    """Long-lived API token for automation (MCP, scripts). Only digests are stored."""

    __tablename__ = "personal_access_tokens"
    __table_args__ = (
        Index("ix_pat_user_active", "user_id", "revoked_at"),
        Index("ix_pat_token_hash", "token_hash", unique=True),
        Index("ix_pat_public_key_id", "public_key_id", unique=True),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Legacy: SHA-256 of full fd_pat_ token. New rows may leave a placeholder unique value.
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    public_key_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    secret_digest: Mapped[str | None] = mapped_column(String(128), nullable=True)
    display_suffix: Mapped[str | None] = mapped_column(String(8), nullable=True)
    hash_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    pepper_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    environment: Mapped[str] = mapped_column(String(16), nullable=False, default="live", server_default="live")
    rotated_from_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("personal_access_tokens.id", ondelete="SET NULL"), nullable=True
    )
    revoke_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
