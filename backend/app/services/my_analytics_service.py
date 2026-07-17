"""Personal analytics — always scoped to the authenticated user (JWT)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.activity import ActivityLog
from app.models.comment import Comment, Mention
from app.models.presence import PresenceEvent, UserSession
from app.models.project import Project
from app.models.task import Task, TaskAssignee, TaskAttachment
from app.models.time_entry import TimeEntry
from app.models.user import Profile
from app.schemas.my_analytics import (
    BenchmarkMetric,
    CollaborationOut,
    DeadlinePerformanceOut,
    DeadlineSlice,
    MonthlySummary,
    MyAnalyticsOverview,
    MyAnalyticsOverviewOut,
    PersonalActivityItem,
    PersonalActivityOut,
    PersonalBenchmarksOut,
    PriorityAnalysisOut,
    PrioritySlice,
    ProductivityTrendOut,
    ProjectContributionOut,
    ProjectContributionRow,
    TaskTrendDay,
    TaskTrendsOut,
    TimeDistributionOut,
    TimeDistributionSlice,
    TrendPoint,
    WorkPatternOut,
)
from app.services.analytics_timezone import (
    canonical_timezone_name,
    to_local_date,
    viewer_timezone,
)
from app.services.permission_service import PermissionService

_OVERVIEW_DAYS = 30
_DEADLINE_DAYS = 90
_PHASE2_DAYS = 30

_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_WEEKDAY_SHORT = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

_PRIORITY_MAP = {
    "urgent": ("critical", "Critical"),
    "high": ("high", "High"),
    "normal": ("medium", "Medium"),
    "low": ("low", "Low"),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _month_start(d: date) -> datetime:
    return datetime.combine(d.replace(day=1), time.min, tzinfo=timezone.utc)


def _assigned_task_filters(user_id: uuid.UUID, workspace_ids: list[uuid.UUID]) -> list:
    if not workspace_ids:
        return [Task.id.is_(None)]  # empty set
    project_ids = select(Project.id).where(
        Project.workspace_id.in_(workspace_ids),
        Project.deleted_at.is_(None),
    )
    assigned = select(TaskAssignee.task_id).where(TaskAssignee.user_id == user_id)
    return [
        Task.deleted_at.is_(None),
        Task.is_archived.is_(False),
        Task.parent_task_id.is_(None),
        Task.project_id.in_(project_ids),
        Task.id.in_(assigned),
    ]


def _entry_seconds(entry: TimeEntry) -> int:
    if entry.duration_seconds is not None:
        return max(0, int(entry.duration_seconds))
    if entry.ended_at:
        return max(0, int((_aware(entry.ended_at) - _aware(entry.started_at)).total_seconds()))
    # Running timer — count elapsed so far
    return max(0, int((_now() - _aware(entry.started_at)).total_seconds()))


def _task_timer_seconds(
    db: Session, user_id: uuid.UUID, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Sum timer seconds per task for this user. Tasks with no timer are omitted."""
    if not task_ids:
        return {}
    entries = db.scalars(
        select(TimeEntry).where(
            TimeEntry.user_id == user_id,
            TimeEntry.task_id.in_(task_ids),
        )
    ).all()
    totals: dict[uuid.UUID, int] = {}
    for entry in entries:
        totals[entry.task_id] = totals.get(entry.task_id, 0) + _entry_seconds(entry)
    return totals


def _avg_timer_seconds(
    db: Session, user_id: uuid.UUID, task_ids: list[uuid.UUID]
) -> int:
    """Average logged timer duration across timed tasks. Zero if no timer started."""
    totals = _task_timer_seconds(db, user_id, task_ids)
    if not totals:
        return 0
    values = list(totals.values())
    return int(sum(values) / len(values))


def _deadline_bucket(task: Task, tz) -> str | None:
    """Classify a completed task with due_date as early | on_time | late (local calendar)."""
    if not task.completed_at or not task.due_date:
        return None
    completed_day = to_local_date(_aware(task.completed_at), tz)
    due = task.due_date
    if completed_day < due:
        return "early"
    if completed_day == due:
        return "on_time"
    return "late"


def _productivity_streak(db: Session, user_id: uuid.UUID, base_filters: list) -> int:
    """Consecutive calendar days ending today with at least one completed assigned task."""
    today = _now().date()
    streak = 0
    for offset in range(365):
        day = today - timedelta(days=offset)
        start = datetime.combine(day, time.min, tzinfo=timezone.utc)
        end = start + timedelta(days=1)
        count = db.scalar(
            select(func.count(Task.id)).where(
                *base_filters,
                Task.completed_at.is_not(None),
                Task.completed_at >= start,
                Task.completed_at < end,
            )
        ) or 0
        if count > 0:
            streak += 1
        elif offset > 0:
            break
        else:
            break
    return streak


def get_overview(db: Session, perms: PermissionService) -> MyAnalyticsOverviewOut:
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    base = _assigned_task_filters(user_id, workspace_ids)
    tz = viewer_timezone(db, user_id)
    now = _now()
    period_start = now - timedelta(days=_OVERVIEW_DAYS)
    month_start = _month_start(now.date())
    if now.month == 12:
        month_end = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        month_end = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)

    tasks_completed = db.scalar(
        select(func.count(Task.id)).where(
            *base,
            Task.completed_at.is_not(None),
            Task.completed_at >= period_start,
        )
    ) or 0

    total_assigned = db.scalar(select(func.count(Task.id)).where(*base)) or 0
    total_completed_all = db.scalar(
        select(func.count(Task.id)).where(*base, Task.completed_at.is_not(None))
    ) or 0
    completion_rate = round((total_completed_all / total_assigned) * 100) if total_assigned else 0

    completed_rows = db.scalars(
        select(Task).where(
            *base,
            Task.completed_at.is_not(None),
            Task.completed_at >= period_start,
        )
    ).all()
    # Avg Completion = mean of task timer durations; 0 if no timer was started.
    avg_completion_time = _avg_timer_seconds(db, user_id, [t.id for t in completed_rows])

    with_due = [t for t in completed_rows if t.due_date]
    on_time_count = sum(1 for t in with_due if _deadline_bucket(t, tz) in ("early", "on_time"))
    on_time_delivery = round((on_time_count / len(with_due)) * 100) if with_due else 0

    streak = _productivity_streak(db, user_id, base)

    overview = MyAnalyticsOverview(
        tasks_completed=int(tasks_completed),
        completion_rate=int(completion_rate),
        avg_completion_time=avg_completion_time,
        on_time_delivery=int(on_time_delivery),
        productivity_streak=streak,
    )

    month_completed = db.scalar(
        select(func.count(Task.id)).where(
            *base,
            Task.completed_at.is_not(None),
            Task.completed_at >= month_start,
            Task.completed_at < month_end,
        )
    ) or 0

    projects_worked = db.scalar(
        select(func.count(func.distinct(Task.project_id))).where(
            *base,
            or_(
                and_(
                    Task.completed_at.is_not(None),
                    Task.completed_at >= month_start,
                    Task.completed_at < month_end,
                ),
                Task.updated_at >= month_start,
            ),
        )
    ) or 0

    comments = db.scalar(
        select(func.count(Comment.id)).where(
            Comment.author_id == user_id,
            Comment.deleted_at.is_(None),
            Comment.created_at >= month_start,
            Comment.created_at < month_end,
        )
    ) or 0

    attachments = db.scalar(
        select(func.count(TaskAttachment.id)).where(
            TaskAttachment.uploaded_by == user_id,
            TaskAttachment.deleted_at.is_(None),
            TaskAttachment.created_at >= month_start,
            TaskAttachment.created_at < month_end,
        )
    ) or 0

    late_completed = sum(
        1
        for t in db.scalars(
            select(Task).where(
                *base,
                Task.completed_at.is_not(None),
                Task.completed_at >= month_start,
                Task.completed_at < month_end,
                Task.due_date.is_not(None),
            )
        ).all()
        if _deadline_bucket(t, tz) == "late"
    )
    open_overdue = db.scalar(
        select(func.count(Task.id)).where(
            *base,
            Task.completed_at.is_(None),
            Task.due_date.is_not(None),
            Task.due_date < now.date(),
        )
    ) or 0

    monthly_summary = MonthlySummary(
        month=now.strftime("%Y-%m"),
        completed_tasks=int(month_completed),
        projects_worked=int(projects_worked),
        comments=int(comments),
        attachments=int(attachments),
        late_tasks=int(late_completed + open_overdue),
    )

    return MyAnalyticsOverviewOut(overview=overview, monthly_summary=monthly_summary)


def get_productivity_trend(
    db: Session, perms: PermissionService, period: Literal["week", "month"] = "week"
) -> ProductivityTrendOut:
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    base = _assigned_task_filters(user_id, workspace_ids)
    days = 7 if period == "week" else 30
    now = _now()
    start = datetime.combine((now - timedelta(days=days - 1)).date(), time.min, tzinfo=timezone.utc)

    points: list[TrendPoint] = []
    values: list[int] = []
    for i in range(days):
        day = (start + timedelta(days=i)).date()
        day_start = datetime.combine(day, time.min, tzinfo=timezone.utc)
        day_end = day_start + timedelta(days=1)
        count = db.scalar(
            select(func.count(Task.id)).where(
                *base,
                Task.completed_at.is_not(None),
                Task.completed_at >= day_start,
                Task.completed_at < day_end,
            )
        ) or 0
        points.append(TrendPoint(date=day.isoformat(), value=int(count)))
        values.append(int(count))

    total = sum(values)
    average = round(total / len(values)) if values else 0
    return ProductivityTrendOut(period=period, points=points, total=total, average=average)


def get_task_trends(db: Session, perms: PermissionService) -> TaskTrendsOut:
    """Completed tasks for the current local week — one bar per weekday (Mon–Sun)."""
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    base = _assigned_task_filters(user_id, workspace_ids)
    tz = viewer_timezone(db, user_id)
    now_local = _now().astimezone(tz)
    week_start_local = datetime.combine(
        now_local.date() - timedelta(days=now_local.weekday()),
        time.min,
        tzinfo=tz,
    )

    points: list[TaskTrendDay] = []
    total = 0
    for i in range(7):
        day_start_local = week_start_local + timedelta(days=i)
        day_end_local = day_start_local + timedelta(days=1)
        count = db.scalar(
            select(func.count(Task.id)).where(
                *base,
                Task.completed_at.is_not(None),
                Task.completed_at >= day_start_local.astimezone(timezone.utc),
                Task.completed_at < day_end_local.astimezone(timezone.utc),
            )
        ) or 0
        day = day_start_local.date()
        points.append(
            TaskTrendDay(
                date=day.isoformat(),
                weekday=_WEEKDAY_SHORT[i],
                completed=int(count),
            )
        )
        total += int(count)

    return TaskTrendsOut(
        week_start=week_start_local.date().isoformat(),
        points=points,
        total=total,
    )


def get_deadline_performance(
    db: Session, perms: PermissionService, days: int = _DEADLINE_DAYS
) -> DeadlinePerformanceOut:
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    base = _assigned_task_filters(user_id, workspace_ids)
    days = max(1, min(days, 365))
    tz = viewer_timezone(db, user_id)
    since = _now() - timedelta(days=days)

    tasks = db.scalars(
        select(Task).where(
            *base,
            Task.completed_at.is_not(None),
            Task.due_date.is_not(None),
            Task.completed_at >= since,
            # Strict personal scope: assignee must be the authenticated user
            # (already in base) — never aggregate other members' completions.
        )
    ).all()

    buckets = {"early": 0, "on_time": 0, "late": 0}
    for task in tasks:
        bucket = _deadline_bucket(task, tz)
        if bucket:
            buckets[bucket] += 1

    total = sum(buckets.values())
    on_time_rate = round(((buckets["early"] + buckets["on_time"]) / total) * 100) if total else 0
    slices = [
        DeadlineSlice(label="early", count=buckets["early"]),
        DeadlineSlice(label="on_time", count=buckets["on_time"]),
        DeadlineSlice(label="late", count=buckets["late"]),
    ]
    return DeadlinePerformanceOut(days=days, total=total, slices=slices, on_time_rate=int(on_time_rate))


def _activity_type(action: str, data: dict) -> tuple[str, str, str | None]:
    """Map activity log action → (type, title, description)."""
    ref = data.get("ref", "")
    title_text = data.get("title", "")
    if action == "task.status_changed":
        new_cat = data.get("new_category") or data.get("status_category")
        if new_cat == "done":
            return "task_completed", f"Completed {ref}", title_text or None
        if new_cat == "in_progress":
            return "task_started", f"Started {ref}", title_text or None
        return "activity", f"Updated status on {ref}", title_text or None
    if action == "task.created":
        return "task_started", f"Created {ref}", title_text or None
    if action == "attachment.added":
        fname = data.get("file_name", "file")
        return "file_upload", f"Uploaded {fname}", ref or None
    if action.startswith("task."):
        return "activity", action.replace("task.", "Task ").replace("_", " "), title_text or None
    return "activity", action.replace(".", " ").replace("_", " ").title(), None


def get_activity(db: Session, perms: PermissionService, limit: int = 50) -> PersonalActivityOut:
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    limit = max(1, min(limit, 100))
    items: list[PersonalActivityItem] = []

    # Presence: login / logout
    for ev in db.scalars(
        select(PresenceEvent)
        .where(PresenceEvent.user_id == user_id, PresenceEvent.event_type.in_(("login", "logout")))
        .order_by(PresenceEvent.created_at.desc())
        .limit(limit)
    ).all():
        items.append(
            PersonalActivityItem(
                id=f"presence-{ev.id}",
                type=ev.event_type,
                title="Logged in" if ev.event_type == "login" else "Logged out",
                created_at=_aware(ev.created_at),
            )
        )

    # Task activity logs
    if workspace_ids:
        project_names: dict[uuid.UUID, str] = dict(
            db.execute(
                select(Project.id, Project.name).where(Project.workspace_id.in_(workspace_ids))
            ).all()
        )
        for row in db.scalars(
            select(ActivityLog)
            .where(ActivityLog.actor_id == user_id, ActivityLog.workspace_id.in_(workspace_ids))
            .order_by(ActivityLog.created_at.desc())
            .limit(limit)
        ).all():
            atype, title, desc = _activity_type(row.action, row.data or {})
            items.append(
                PersonalActivityItem(
                    id=f"activity-{row.id}",
                    type=atype,
                    title=title,
                    description=desc,
                    project_id=str(row.project_id) if row.project_id else None,
                    project_name=project_names.get(row.project_id) if row.project_id else None,
                    task_id=str(row.task_id) if row.task_id else None,
                    created_at=_aware(row.created_at),
                )
            )

    # Comments
    for c in db.scalars(
        select(Comment)
        .where(Comment.author_id == user_id, Comment.deleted_at.is_(None))
        .order_by(Comment.created_at.desc())
        .limit(limit)
    ).all():
        preview = (c.body[:80] + "…") if len(c.body) > 80 else c.body
        items.append(
            PersonalActivityItem(
                id=f"comment-{c.id}",
                type="comment",
                title="Posted a comment",
                description=preview,
                task_id=str(c.task_id),
                created_at=_aware(c.created_at),
            )
        )

    # File uploads (attachments table)
    for att in db.scalars(
        select(TaskAttachment)
        .where(TaskAttachment.uploaded_by == user_id, TaskAttachment.deleted_at.is_(None))
        .order_by(TaskAttachment.created_at.desc())
        .limit(limit)
    ).all():
        items.append(
            PersonalActivityItem(
                id=f"attachment-{att.id}",
                type="file_upload",
                title=f"Uploaded {att.file_name}",
                task_id=str(att.task_id),
                created_at=_aware(att.created_at),
            )
        )

    # Completed tasks (when no activity log exists)
    base = _assigned_task_filters(user_id, workspace_ids)
    for task in db.scalars(
        select(Task)
        .where(*base, Task.completed_at.is_not(None))
        .order_by(Task.completed_at.desc())
        .limit(limit)
    ).all():
        items.append(
            PersonalActivityItem(
                id=f"completed-{task.id}",
                type="task_completed",
                title=f"Completed task",
                description=task.title,
                project_id=str(task.project_id),
                task_id=str(task.id),
                created_at=_aware(task.completed_at),  # type: ignore[arg-type]
            )
        )

    items.sort(key=lambda x: x.created_at, reverse=True)
    seen: set[str] = set()
    deduped: list[PersonalActivityItem] = []
    for item in items:
        key = f"{item.type}:{item.task_id}:{item.created_at.isoformat()}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
        if len(deduped) >= limit:
            break

    return PersonalActivityOut(items=deduped)


# ---------------------------------------------------------------------------
# Phase 2: work pattern, time distribution, contribution, collaboration,
# priority analysis, personal benchmarks
# ---------------------------------------------------------------------------


def _period_start(days: int) -> datetime:
    return _now() - timedelta(days=max(1, min(days, 365)))


# Ignore thin reconnect blips when deriving typical work hours.
_MIN_WORK_DAY_ACTIVE_SECONDS = 30 * 60  # ≥ 30 minutes of presence that day
_MIN_WORK_DAY_SPAN_MINUTES = 90  # or first→last activity span ≥ 1.5 hours


def _format_hhmm(minutes_from_midnight: int) -> str:
    h, m = divmod(max(0, min(minutes_from_midnight, 23 * 60 + 59)), 60)
    return f"{h:02d}:{m:02d}"


def _session_end(session: UserSession, now: datetime) -> datetime:
    """Latest known activity on the session (logout and last_activity can differ)."""
    candidates: list[datetime] = []
    if session.logout_time is not None:
        candidates.append(_aware(session.logout_time))
    if session.last_activity is not None:
        candidates.append(_aware(session.last_activity))
    if not candidates:
        return now
    return max(candidates)


def _avg_daily_login_logout(
    sessions: list[UserSession], tz, now: datetime | None = None
) -> tuple[str | None, str | None]:
    """Typical work start/end from each day's presence window.

    For every local calendar day, merge all session spans into one window:
    first activity → last activity. Mid-day session restarts (idle gaps, refresh)
    only fill the same window — they are not averaged as separate logins.

    Thin days (short reconnect blips) are excluded so they cannot pull a true
    10:00–19:00 workday toward noon.
    """
    now = now or _now()
    day_first: dict[date, int] = {}
    day_last: dict[date, int] = {}
    day_active_seconds: dict[date, int] = {}

    for session in sessions:
        start = _aware(session.login_time)
        end = _session_end(session, now)
        if end < start:
            end = start

        start_local = start.astimezone(tz)
        end_local = end.astimezone(tz)
        cursor = datetime.combine(start_local.date(), time.min, tzinfo=tz)
        last_day = end_local.date()

        while cursor.date() <= last_day:
            day = cursor.date()
            day_start = cursor
            day_end = day_start + timedelta(days=1)
            seg_start = max(start_local, day_start)
            seg_end = min(end_local, day_end)
            if seg_end > seg_start:
                start_mins = seg_start.hour * 60 + seg_start.minute
                if seg_end >= day_end:
                    end_mins = 23 * 60 + 59
                else:
                    end_mins = seg_end.hour * 60 + seg_end.minute
                secs = int((seg_end - seg_start).total_seconds())
                prev_first = day_first.get(day)
                if prev_first is None or start_mins < prev_first:
                    day_first[day] = start_mins
                prev_last = day_last.get(day)
                if prev_last is None or end_mins > prev_last:
                    day_last[day] = end_mins
                day_active_seconds[day] = day_active_seconds.get(day, 0) + secs
            cursor = day_end

    login_vals: list[int] = []
    logout_vals: list[int] = []
    for day, first in day_first.items():
        last = day_last.get(day)
        if last is None or last < first:
            continue
        span = last - first
        active = day_active_seconds.get(day, 0)
        # Keep real workdays (e.g. 10:00–19:00); drop short reconnect-only days.
        if active < _MIN_WORK_DAY_ACTIVE_SECONDS and span < _MIN_WORK_DAY_SPAN_MINUTES:
            continue
        login_vals.append(first)
        logout_vals.append(last)

    avg_login = (
        _format_hhmm(int(sum(login_vals) / len(login_vals))) if login_vals else None
    )
    avg_logout = (
        _format_hhmm(int(sum(logout_vals) / len(logout_vals))) if logout_vals else None
    )
    return avg_login, avg_logout


def _priority_bucket(priority: str | None) -> tuple[str, str]:
    key, label = _PRIORITY_MAP.get(priority or "normal", ("medium", "Medium"))
    return key, label


def get_work_pattern(db: Session, perms: PermissionService, days: int = _PHASE2_DAYS) -> WorkPatternOut:
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    base = _assigned_task_filters(user_id, workspace_ids)
    since = _period_start(days)
    tz = viewer_timezone(db, user_id)
    profile = db.scalar(select(Profile).where(Profile.user_id == user_id))
    tz_name = canonical_timezone_name(profile.timezone if profile else None)

    completed = db.scalars(
        select(Task).where(*base, Task.completed_at.is_not(None), Task.completed_at >= since)
    ).all()

    day_counts = [0] * 7
    hour_counts = [0] * 24
    for task in completed:
        local = _aware(task.completed_at).astimezone(tz)  # type: ignore[arg-type]
        day_counts[local.weekday()] += 1
        hour_counts[local.hour] += 1

    most_day = None
    if any(day_counts):
        most_day = _WEEKDAYS[day_counts.index(max(day_counts))]
    most_hour = hour_counts.index(max(hour_counts)) if any(hour_counts) else None

    sessions = db.scalars(
        select(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.login_time >= since,
        )
    ).all()
    avg_login, avg_logout = _avg_daily_login_logout(sessions, tz)

    return WorkPatternOut(
        days=days,
        most_productive_day=most_day,
        most_productive_hour=most_hour,
        avg_login_time=avg_login,
        avg_logout_time=avg_logout,
        timezone=tz_name,
    )


def get_time_distribution(
    db: Session, perms: PermissionService, days: int = _PHASE2_DAYS
) -> TimeDistributionOut:
    """Timer seconds spent per project (not activity categories)."""
    user_id = perms.user.id
    since = _period_start(days)
    entries = db.scalars(
        select(TimeEntry).where(TimeEntry.user_id == user_id, TimeEntry.started_at >= since)
    ).all()
    if not entries:
        return TimeDistributionOut(days=days, total_seconds=0, slices=[])

    task_ids = {entry.task_id for entry in entries}
    tasks = {
        t.id: t
        for t in db.scalars(select(Task).where(Task.id.in_(task_ids))).all()
    }
    project_ids = {t.project_id for t in tasks.values() if t.project_id}
    projects = {
        p.id: p
        for p in db.scalars(select(Project).where(Project.id.in_(project_ids))).all()
    } if project_ids else {}

    # project_id -> seconds
    buckets: dict[uuid.UUID | None, int] = {}
    for entry in entries:
        task = tasks.get(entry.task_id)
        project_id = task.project_id if task else None
        buckets[project_id] = buckets.get(project_id, 0) + _entry_seconds(entry)

    total = sum(buckets.values())
    rows: list[tuple[uuid.UUID | None, int]] = sorted(
        buckets.items(), key=lambda item: item[1], reverse=True
    )
    slices = [
        TimeDistributionSlice(
            project_id=str(pid) if pid else None,
            category=str(pid) if pid else "unknown",
            label=(projects[pid].name if pid and pid in projects else "Unknown project"),
            seconds=secs,
            percentage=round((secs / total) * 100) if total else 0,
        )
        for pid, secs in rows
        if secs > 0
    ]
    return TimeDistributionOut(days=days, total_seconds=total, slices=slices)


def get_project_contribution(
    db: Session, perms: PermissionService, days: int = _PHASE2_DAYS
) -> ProjectContributionOut:
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    base = _assigned_task_filters(user_id, workspace_ids)
    since = _period_start(days)

    rows = db.execute(
        select(Project.id, Project.name, func.count(Task.id))
        .join(Task, Task.project_id == Project.id)
        .where(*base, Task.completed_at.is_not(None), Task.completed_at >= since)
        .group_by(Project.id, Project.name)
        .order_by(func.count(Task.id).desc())
    ).all()

    total = sum(int(r[2]) for r in rows)
    projects = [
        ProjectContributionRow(
            project_id=str(row[0]),
            project_name=row[1],
            completed_tasks=int(row[2]),
            percentage=round((int(row[2]) / total) * 100) if total else 0,
        )
        for row in rows
    ]
    return ProjectContributionOut(days=days, total_completed=total, projects=projects)


def get_collaboration(db: Session, perms: PermissionService, days: int = _PHASE2_DAYS) -> CollaborationOut:
    user_id = perms.user.id
    since = _period_start(days)

    comments = db.scalar(
        select(func.count(Comment.id)).where(
            Comment.author_id == user_id,
            Comment.deleted_at.is_(None),
            Comment.created_at >= since,
        )
    ) or 0

    mentions = db.scalar(
        select(func.count(Mention.id)).where(
            Mention.mentioned_user_id == user_id,
            Mention.created_at >= since,
        )
    ) or 0

    attachments = db.scalar(
        select(func.count(TaskAttachment.id)).where(
            TaskAttachment.uploaded_by == user_id,
            TaskAttachment.deleted_at.is_(None),
            TaskAttachment.created_at >= since,
        )
    ) or 0

    # Reviews ≈ comments on tasks the user is not assigned to (peer feedback).
    assigned_ids = select(TaskAssignee.task_id).where(TaskAssignee.user_id == user_id)
    reviews = db.scalar(
        select(func.count(Comment.id))
        .join(Task, Task.id == Comment.task_id)
        .where(
            Comment.author_id == user_id,
            Comment.deleted_at.is_(None),
            Comment.created_at >= since,
            ~Task.id.in_(assigned_ids),
        )
    ) or 0

    return CollaborationOut(
        days=days,
        comments=int(comments),
        mentions=int(mentions),
        reviews=int(reviews),
        attachments=int(attachments),
    )


def get_priority_analysis(
    db: Session, perms: PermissionService, days: int = _PHASE2_DAYS
) -> PriorityAnalysisOut:
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    base = _assigned_task_filters(user_id, workspace_ids)
    since = _period_start(days)

    tasks = db.scalars(
        select(Task).where(*base, Task.completed_at.is_not(None), Task.completed_at >= since)
    ).all()
    buckets: dict[str, dict] = {
        "critical": {"label": "Critical", "count": 0},
        "high": {"label": "High", "count": 0},
        "medium": {"label": "Medium", "count": 0},
        "low": {"label": "Low", "count": 0},
    }
    for task in tasks:
        key, label = _priority_bucket(task.priority)
        buckets[key]["count"] += 1
        buckets[key]["label"] = label

    total = sum(b["count"] for b in buckets.values())
    slices = [
        PrioritySlice(
            priority=key,
            label=info["label"],
            count=info["count"],
            percentage=round((info["count"] / total) * 100) if total else 0,
        )
        for key, info in buckets.items()
    ]
    return PriorityAnalysisOut(days=days, total=total, slices=slices)


def _benchmark_window(period: Literal["week", "month"]) -> tuple[datetime, datetime, datetime]:
    """Return (previous_start, current_start, now)."""
    now = _now()
    if period == "week":
        current_start = datetime.combine(
            (now - timedelta(days=now.weekday())).date(), time.min, tzinfo=timezone.utc
        )
        previous_start = current_start - timedelta(days=7)
    else:
        current_start = _month_start(now.date())
        if now.month == 1:
            previous_start = datetime(now.year - 1, 12, 1, tzinfo=timezone.utc)
        else:
            previous_start = datetime(now.year, now.month - 1, 1, tzinfo=timezone.utc)
    return previous_start, current_start, now


def _completed_in_window(db: Session, base: list, start: datetime, end: datetime) -> int:
    return db.scalar(
        select(func.count(Task.id)).where(
            *base,
            Task.completed_at.is_not(None),
            Task.completed_at >= start,
            Task.completed_at < end,
        )
    ) or 0


def _avg_completion_seconds(
    db: Session, user_id: uuid.UUID, base: list, start: datetime, end: datetime
) -> int:
    tasks = db.scalars(
        select(Task).where(
            *base,
            Task.completed_at.is_not(None),
            Task.completed_at >= start,
            Task.completed_at < end,
        )
    ).all()
    return _avg_timer_seconds(db, user_id, [t.id for t in tasks])


def _late_tasks_in_window(
    db: Session, base: list, start: datetime, end: datetime, tz
) -> int:
    tasks = db.scalars(
        select(Task).where(
            *base,
            Task.completed_at.is_not(None),
            Task.completed_at >= start,
            Task.completed_at < end,
            Task.due_date.is_not(None),
        )
    ).all()
    return sum(1 for t in tasks if _deadline_bucket(t, tz) == "late")


def get_benchmarks(
    db: Session, perms: PermissionService, period: Literal["week", "month"] = "week"
) -> PersonalBenchmarksOut:
    user_id = perms.user.id
    workspace_ids = perms.accessible_workspace_ids()
    base = _assigned_task_filters(user_id, workspace_ids)
    tz = viewer_timezone(db, user_id)
    prev_start, current_start, now = _benchmark_window(period)

    prev_completed = _completed_in_window(db, base, prev_start, current_start)
    curr_completed = _completed_in_window(db, base, current_start, now)

    prev_speed = _avg_completion_seconds(db, user_id, base, prev_start, current_start)
    curr_speed = _avg_completion_seconds(db, user_id, base, current_start, now)

    prev_late = _late_tasks_in_window(db, base, prev_start, current_start, tz)
    curr_late = _late_tasks_in_window(db, base, current_start, now, tz)
    def _metric(
        key: str,
        label: str,
        current: int,
        previous: int,
        *,
        lower_is_better: bool = False,
    ) -> BenchmarkMetric:
        change = current - previous
        change_pct = round((change / previous) * 100) if previous else (100 if current else 0)
        if lower_is_better:
            improved = change < 0 or (change == 0 and current == 0)
        else:
            improved = change > 0
        return BenchmarkMetric(
            key=key,
            label=label,
            current=current,
            previous=previous,
            change=change,
            change_pct=change_pct,
            improved=improved,
        )

    unit = "week" if period == "week" else "month"
    metrics = [
        _metric("completion", f"Tasks completed vs last {unit}", curr_completed, prev_completed),
        _metric(
            "speed",
            f"Avg completion time vs last {unit}",
            curr_speed,
            prev_speed,
            lower_is_better=True,
        ),
        _metric(
            "late_reduction",
            f"Late tasks vs last {unit}",
            curr_late,
            prev_late,
            lower_is_better=True,
        ),
    ]
    return PersonalBenchmarksOut(period=period, metrics=metrics)
