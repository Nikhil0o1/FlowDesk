"""Scheduled cron job tasks."""
import logging

from celery_app.app import app
from workers.registry import get_job
from workers.runner import run_logged

logger = logging.getLogger(__name__)


@app.task(
    bind=True,
    name="flowdesk.run_scheduled_job",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def run_scheduled_job(self, job_name: str) -> int:
    """Execute a registered cron job by name (same business logic as APScheduler)."""
    fn = get_job(job_name)
    if fn is None:
        raise ValueError(f"Unknown scheduled job: {job_name}")
    logger.info("Celery running scheduled job: %s (task_id=%s)", job_name, self.request.id)
    return run_logged(job_name, fn, propagate=True)
