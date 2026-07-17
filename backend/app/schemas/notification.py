import uuid
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field

from app.schemas.comment import NotificationOut
from app.schemas.common import ORMModel


class InboxSettingsOut(ORMModel):
    show_all_tab: bool
    group_by_date: bool
    sort_newest_first: bool
    display_mode: str
    email_notifications_enabled: bool
    browser_notifications_enabled: bool
    auto_follow_tasks: bool


class InboxSettingsUpdate(BaseModel):
    show_all_tab: bool | None = None
    group_by_date: bool | None = None
    sort_newest_first: bool | None = None
    display_mode: str | None = Field(default=None, pattern="^(fullscreen|inline)$")
    email_notifications_enabled: bool | None = None
    browser_notifications_enabled: bool | None = None
    auto_follow_tasks: bool | None = None


class NotificationTypePreferenceOut(BaseModel):
    type: str
    label: str
    important: bool
    section: str


class NotificationPreferencesOut(BaseModel):
    items: list[NotificationTypePreferenceOut]
    important_count: int
    total_count: int


class NotificationPreferencesPatch(BaseModel):
    type: str
    important: bool


class NotificationPreferencesReset(BaseModel):
    reset: bool = True


class NotificationSummaryOut(BaseModel):
    mentions: int
    assigned_to_me: int
    unread: int
    reminders: int


class NotificationOutExtended(NotificationOut):
    snoozed_until: datetime | None = None
    cleared_at: datetime | None = None
    important: bool = True


class SnoozeBody(BaseModel):
    until: datetime | None = None


CLEARED_RETENTION_DAYS = 30


def default_snooze_until() -> datetime:
    now = datetime.now(timezone.utc)
    target = now + timedelta(days=1)
    return target.replace(hour=9, minute=0, second=0, microsecond=0)
