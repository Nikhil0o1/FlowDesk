import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin


class InboxSettings(Base, TimestampMixin):
    __tablename__ = "inbox_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    show_all_tab: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    group_by_date: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_newest_first: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    display_mode: Mapped[str] = mapped_column(String(20), default="fullscreen", nullable=False)
    email_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    browser_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auto_follow_tasks: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class NotificationTypePreference(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "notification_type_preferences"
    __table_args__ = (UniqueConstraint("user_id", "type", name="uq_notification_type_pref_user_type"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type: Mapped[str] = mapped_column(String(60), nullable=False)
    important: Mapped[bool] = mapped_column(Boolean, nullable=False)
