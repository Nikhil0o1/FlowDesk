"""Job registry — maps schedule config to callables for APScheduler and Celery."""
from collections.abc import Callable

from apscheduler.triggers.base import BaseTrigger
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from workers import jobs
from workers.schedule_config import CronSpec, IntervalSpec, JOB_SCHEDULES, ScheduleSpec

JobFn = Callable[[Session], int | None]

_JOB_FUNCTIONS: dict[str, JobFn] = {
    "due_date_reminders": jobs.due_date_reminders,
    "overdue_task_notifications": jobs.overdue_task_notifications,
    "stop_abandoned_timers": jobs.stop_abandoned_timers,
    "daily_digest": jobs.daily_digest,
    "github_sync_fallback": jobs.github_sync_fallback,
    "recurring_task_generation": jobs.recurring_task_generation,
    "sprint_completion_reminder": jobs.sprint_completion_reminder,
    "cleanup_expired_invites": jobs.cleanup_expired_invites,
    "google_sheet_sync": jobs.google_sheet_sync,
    "pat_apply_delayed_revocations": jobs.pat_apply_delayed_revocations,
    "pat_cleanup_expired": jobs.pat_cleanup_expired,
    "pat_flush_denial_audits": jobs.pat_flush_denial_audits,
    "pat_pepper_migration_report": jobs.pat_pepper_migration_report,
    "webhook_delivery_reconciliation": jobs.webhook_delivery_reconciliation,
    "webhook_delivery_purge": jobs.webhook_delivery_purge,
}


def _to_apscheduler_trigger(spec: ScheduleSpec) -> BaseTrigger:
    if isinstance(spec, CronSpec):
        return CronTrigger(hour=spec.hour, minute=spec.minute)
    kwargs: dict[str, int] = {}
    if spec.minutes:
        kwargs["minutes"] = spec.minutes
    if spec.hours:
        kwargs["hours"] = spec.hours
    return IntervalTrigger(**kwargs)


def get_job(name: str) -> JobFn | None:
    return _JOB_FUNCTIONS.get(name)


def job_names() -> list[str]:
    return list(JOB_SCHEDULES.keys())


def job_definitions() -> list[tuple[str, JobFn, BaseTrigger]]:
    result: list[tuple[str, JobFn, BaseTrigger]] = []
    for name, spec in JOB_SCHEDULES.items():
        fn = _JOB_FUNCTIONS.get(name)
        if fn is None:
            continue
        result.append((name, fn, _to_apscheduler_trigger(spec)))
    return result
