"""Presence, session, and presence-event tables backing the Analytics module.

These are intentionally decoupled from the WebSocket connection manager (which
tracks live online sockets in-memory). This DB layer is the durable source of
truth for analytics: heartbeats keep ``user_presence.last_seen`` fresh, sessions
capture login/logout windows (device/browser/ip), and ``presence_events`` records
an append-only audit of status transitions.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin

# Effective presence states surfaced to analytics.
PRESENCE_STATUSES = ("online", "away", "busy", "offline")


class UserPresence(Base, UUIDPkMixin, TimestampMixin):
    """Current presence for a user — one row per user, upserted on heartbeat."""

    __tablename__ = "user_presence"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    # Client-declared status (online | away | busy | offline). The *effective*
    # status shown in analytics also factors in last_seen staleness.
    status: Mapped[str] = mapped_column(String(20), default="offline", nullable=False)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSession(Base, UUIDPkMixin, TimestampMixin):
    """A login → logout window. The open session (logout_time is NULL) is the
    user's current session; heartbeats bump ``last_activity``."""

    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("ix_user_sessions_user_login", "user_id", "login_time"),
        Index("ix_user_sessions_open", "user_id", "logout_time"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    login_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    logout_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_activity: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Duration in seconds, materialized when the session closes (for cheap aggregation).
    session_duration: Mapped[int | None] = mapped_column(Integer)
    device: Mapped[str | None] = mapped_column(String(120))
    browser: Mapped[str | None] = mapped_column(String(120))
    ip_address: Mapped[str | None] = mapped_column(String(64))


class PresenceEvent(Base, UUIDPkMixin):
    """Append-only log of presence transitions (login/logout/status changes)."""

    __tablename__ = "presence_events"
    __table_args__ = (
        Index("ix_presence_events_user_created", "user_id", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # login | logout | status_change | away | busy | online
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    old_status: Mapped[str | None] = mapped_column(String(20))
    new_status: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
