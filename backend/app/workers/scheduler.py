"""APScheduler-based cron runner, started with the API process in dev.

For multi-instance production deployments, run this on a single dedicated
worker process (python -m app.workers.scheduler) and set SCHEDULER_ENABLED=false
on the API instances.
"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.workers import jobs

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None

JOB_DEFS = [
    ("due_date_reminders", jobs.due_date_reminders, CronTrigger(hour=8, minute=0)),
    ("overdue_task_notifications", jobs.overdue_task_notifications, CronTrigger(hour=8, minute=15)),
    ("stop_abandoned_timers", jobs.stop_abandoned_timers, IntervalTrigger(minutes=30)),
    ("daily_digest", jobs.daily_digest, CronTrigger(hour=7, minute=30)),
    ("github_sync_fallback", jobs.github_sync_fallback, IntervalTrigger(hours=1)),
    ("recurring_task_generation", jobs.recurring_task_generation, IntervalTrigger(minutes=15)),
    ("sprint_completion_reminder", jobs.sprint_completion_reminder, CronTrigger(hour=9, minute=0)),
    ("cleanup_expired_invites", jobs.cleanup_expired_invites, CronTrigger(hour=2, minute=0)),
]


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    scheduler = BackgroundScheduler(timezone="UTC")
    for name, fn, trigger in JOB_DEFS:
        scheduler.add_job(
            jobs.run_logged,
            trigger,
            args=[name, fn],
            id=name,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=3600,
        )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Scheduler started with %d jobs", len(JOB_DEFS))
    return scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


if __name__ == "__main__":
    import time

    start_scheduler()
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        shutdown_scheduler()
