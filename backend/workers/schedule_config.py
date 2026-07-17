"""Single source of truth for scheduled job names and timings.

Used by APScheduler (workers/registry.py) and Celery Beat (celery_app/beat_schedule.py).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CronSpec:
    hour: int
    minute: int = 0


@dataclass(frozen=True)
class IntervalSpec:
    minutes: int = 0
    hours: int = 0


ScheduleSpec = CronSpec | IntervalSpec

JOB_SCHEDULES: dict[str, ScheduleSpec] = {
    "due_date_reminders": CronSpec(hour=8, minute=0),
    "overdue_task_notifications": CronSpec(hour=8, minute=15),
    "stop_abandoned_timers": IntervalSpec(minutes=30),
    "daily_digest": CronSpec(hour=7, minute=30),
    "github_sync_fallback": IntervalSpec(minutes=15),
    "recurring_task_generation": IntervalSpec(minutes=15),
    "sprint_completion_reminder": CronSpec(hour=9, minute=0),
    "cleanup_expired_invites": CronSpec(hour=2, minute=0),
    "google_sheet_sync": IntervalSpec(minutes=10),
    "pat_apply_delayed_revocations": IntervalSpec(minutes=1),
    "pat_cleanup_expired": CronSpec(hour=3, minute=15),
    "pat_flush_denial_audits": IntervalSpec(minutes=5),
    "pat_pepper_migration_report": CronSpec(hour=4, minute=0),
    "webhook_delivery_reconciliation": IntervalSpec(minutes=5),
    "webhook_delivery_purge": CronSpec(hour=3, minute=30),
}
