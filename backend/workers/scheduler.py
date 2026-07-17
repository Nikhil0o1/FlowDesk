"""APScheduler lifecycle — shared by the API (dev) and the dedicated worker process."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler

from workers.registry import job_definitions
from workers.runner import run_logged

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def start_scheduler() -> BackgroundScheduler:
    """Start the background scheduler and register all jobs from the registry."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    scheduler = BackgroundScheduler(timezone="UTC")
    for name, fn, trigger in job_definitions():
        scheduler.add_job(
            run_logged,
            trigger,
            args=[name, fn],
            id=name,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=3600,
        )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Scheduler started with %d jobs", len(job_definitions()))
    return scheduler


def shutdown_scheduler() -> None:
    """Stop the background scheduler if running."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
