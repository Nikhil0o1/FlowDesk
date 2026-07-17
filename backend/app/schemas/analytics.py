import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief

PresenceStatus = Literal["online", "away", "busy", "offline"]


# ---------- presence write payloads ----------


class HeartbeatRequest(BaseModel):
    """Sent every 30–60s while the app is open. Keeps the session alive and
    refreshes last_seen. An optional status lets the client re-assert away/online."""

    status: Literal["online", "away", "busy"] | None = None


class StatusUpdateRequest(BaseModel):
    status: PresenceStatus


# ---------- analytics reads ----------


class OverviewOut(BaseModel):
    total_members: int
    online: int
    offline: int
    busy: int
    away: int
    average_session_duration: int  # seconds, today
    active_users_today: int


class TimelinePoint(BaseModel):
    bucket: datetime
    online: int


class TimelineOut(BaseModel):
    date: str
    timezone: str = "UTC"
    points: list[TimelinePoint]


class StatusSlice(BaseModel):
    status: PresenceStatus
    count: int


class StatusDistributionOut(BaseModel):
    total: int
    slices: list[StatusSlice]


class PresenceUserRow(BaseModel):
    user: UserBrief
    status: PresenceStatus
    role: str | None = None
    teams: list[str] = Field(default_factory=list)
    workspaces: list[str] = Field(default_factory=list)
    login_time: datetime | None = None
    last_seen: datetime | None = None
    session_duration: int | None = None  # seconds
    idle_time: int | None = None  # seconds since last_seen
    device: str | None = None
    browser: str | None = None


class PresenceUsersPage(BaseModel):
    items: list[PresenceUserRow]
    total: int
    page: int
    page_size: int


class ActivityFeedItem(ORMModel):
    id: uuid.UUID
    user: UserBrief | None = None
    event_type: str
    old_status: str | None = None
    new_status: str | None = None
    created_at: datetime


# ---------- team activity comparison ----------


class TeamActivityRow(BaseModel):
    id: str
    name: str
    color: str | None = None
    member_count: int
    online: int
    busy: int
    away: int
    offline: int
    active_today: int


class TeamActivityOut(BaseModel):
    group_by: str
    rows: list[TeamActivityRow]


# ---------- employee detail drawer ----------


class SessionInfo(BaseModel):
    id: uuid.UUID
    login_time: datetime
    logout_time: datetime | None = None
    last_activity: datetime | None = None
    duration: int  # seconds (live for the open session)
    device: str | None = None
    browser: str | None = None
    ip_address: str | None = None
    active: bool


class WeeklyActivityDay(BaseModel):
    date: str
    session_count: int
    total_seconds: int


class StatusTimelineItem(BaseModel):
    event_type: str
    old_status: str | None = None
    new_status: str | None = None
    created_at: datetime


class UserDetailOut(BaseModel):
    row: PresenceUserRow
    title: str | None = None
    timezone: str | None = None
    current_session: SessionInfo | None = None
    recent_sessions: list[SessionInfo] = Field(default_factory=list)
    weekly_activity: list[WeeklyActivityDay] = Field(default_factory=list)
    status_timeline: list[StatusTimelineItem] = Field(default_factory=list)


# ---------- Phase 3: historical trends ----------


class TrendPoint(BaseModel):
    date: str
    active_users: int
    peak_online: int
    total_sessions: int
    avg_session_duration: int  # seconds


class TrendsOut(BaseModel):
    days: int
    timezone: str = "UTC"
    points: list[TrendPoint]
    peak_online: int
    avg_active_users: int
    growth: str  # e.g. "+12%" comparing the last half of the window to the first


# ---------- Phase 3: heatmap ----------


class HeatmapCell(BaseModel):
    weekday: int  # 0 = Monday … 6 = Sunday
    hour: int  # 0–23
    value: int


class HeatmapOut(BaseModel):
    days: int
    max_value: int
    cells: list[HeatmapCell]


class ContributionDay(BaseModel):
    date: str
    count: int


class ContributionHeatmapOut(BaseModel):
    days: int
    timezone: str = "UTC"
    max_count: int
    points: list[ContributionDay]


# ---------- Phase 3: device analytics ----------


class DeviceSlice(BaseModel):
    name: str
    sessions: int
    users: int


class DeviceAnalyticsOut(BaseModel):
    days: int
    total_sessions: int
    devices: list[DeviceSlice]
    browsers: list[DeviceSlice]


# ---------- Phase 3: alerts ----------


class AnalyticsAlert(BaseModel):
    id: str
    level: Literal["info", "warning", "critical"]
    title: str
    description: str
    count: int = 0


class AlertsOut(BaseModel):
    generated_at: datetime
    alerts: list[AnalyticsAlert]
