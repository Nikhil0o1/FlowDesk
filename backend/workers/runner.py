"""Job execution harness — DB session lifecycle and cron_job_logs persistence."""
import logging
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy.orm import Session

import workers.bootstrap  # noqa: F401
from app.db.session import SessionLocal
from app.models.audit import CronJobLog

logger = logging.getLogger(__name__)


def run_logged(
    job_name: str,
    fn: Callable[[Session], int | None],
    *,
    propagate: bool = False,
) -> int:
    """Execute a job with its own DB session and a cron_job_logs record.

    When propagate=True (Celery), re-raises after logging so the broker can retry.
    """
    db = SessionLocal()
    log = CronJobLog(job_name=job_name, started_at=datetime.now(timezone.utc), status="running")
    db.add(log)
    db.commit()
    try:
        count = int(fn(db) or 0)
        log.status = "success"
        log.items_processed = count
        log.finished_at = datetime.now(timezone.utc)
        db.commit()
        return count
    except Exception as exc:
        db.rollback()
        log.status = "failed"
        log.message = str(exc)[:2000]
        log.finished_at = datetime.now(timezone.utc)
        db.commit()
        logger.exception("Cron job %s failed", job_name)
        if propagate:
            raise
        return 0
    finally:
        db.close()
