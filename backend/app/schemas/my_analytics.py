"""Personal analytics schemas — user-scoped, never accepts user_id from client."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class MyAnalyticsOverview(BaseModel):
    tasks_completed: int
    completion_rate: int  # 0–100
    avg_completion_time: int  # seconds
    on_time_delivery: int  # 0–100
    productivity_streak: int  # consecutive days


class MonthlySummary(BaseModel):
    month: str  # YYYY-MM
    completed_tasks: int
    projects_worked: int
    comments: int
    attachments: int
    late_tasks: int


class MyAnalyticsOverviewOut(BaseModel):
    overview: MyAnalyticsOverview
    monthly_summary: MonthlySummary


class TrendPoint(BaseModel):
    date: str
    value: int


class ProductivityTrendOut(BaseModel):
    period: str  # week | month
    points: list[TrendPoint]
    total: int
    average: int


class TaskTrendDay(BaseModel):
    date: str  # YYYY-MM-DD (local calendar day)
    weekday: str  # Mon | Tue | Wed | Thu | Fri | Sat | Sun
    completed: int


class TaskTrendsOut(BaseModel):
    week_start: str  # Monday YYYY-MM-DD of the covered week
    points: list[TaskTrendDay]  # always 7 weekdays, Mon→Sun
    total: int


class DeadlineSlice(BaseModel):
    label: str  # early | on_time | late
    count: int


class DeadlinePerformanceOut(BaseModel):
    days: int
    total: int
    slices: list[DeadlineSlice]
    on_time_rate: int  # early + on_time as % of total


class PersonalActivityItem(BaseModel):
    id: str
    type: str  # login | logout | task_started | task_completed | comment | file_upload | activity
    title: str
    description: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    task_id: str | None = None
    created_at: datetime


class PersonalActivityOut(BaseModel):
    items: list[PersonalActivityItem]


# ---------- Phase 2: advanced analytics ----------


class WorkPatternOut(BaseModel):
    days: int
    most_productive_day: str | None = None
    most_productive_hour: int | None = None
    avg_login_time: str | None = None  # HH:MM — typical first activity (workdays only)
    avg_logout_time: str | None = None  # HH:MM — typical last activity (workdays only)
    timezone: str = "UTC"  # IANA / profile timezone used for bucketing


class TimeDistributionSlice(BaseModel):
    project_id: str | None = None
    category: str  # project_id (kept for clients that key off category)
    label: str  # project name
    seconds: int
    percentage: int


class TimeDistributionOut(BaseModel):
    days: int
    total_seconds: int
    slices: list[TimeDistributionSlice]


class ProjectContributionRow(BaseModel):
    project_id: str
    project_name: str
    completed_tasks: int
    percentage: int


class ProjectContributionOut(BaseModel):
    days: int
    total_completed: int
    projects: list[ProjectContributionRow]


class CollaborationOut(BaseModel):
    days: int
    comments: int
    mentions: int
    reviews: int
    attachments: int


class PrioritySlice(BaseModel):
    priority: str
    label: str
    count: int
    percentage: int


class PriorityAnalysisOut(BaseModel):
    days: int
    total: int
    slices: list[PrioritySlice]


class BenchmarkMetric(BaseModel):
    key: str
    label: str
    current: int
    previous: int
    change: int
    change_pct: int | None = None
    improved: bool


class PersonalBenchmarksOut(BaseModel):
    period: str
    metrics: list[BenchmarkMetric]
