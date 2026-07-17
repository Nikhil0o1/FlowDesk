"""Dedicated worker entry point: python -m workers

For multi-instance production deployments, run this on a separate worker service.
When REDIS_URL is set, use Celery instead: celery -A celery_app.app worker
"""
import logging
import signal
import sys
import time

import workers.bootstrap  # noqa: F401 — register all ORM models before scheduler starts
from workers.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _handle_shutdown(signum, _frame) -> None:
    logger.info("Received signal %s — shutting down worker scheduler", signum)
    shutdown_scheduler()
    sys.exit(0)


def main() -> None:
    from app.core.config import settings

    if settings.celery_configured:
        logger.warning(
            "REDIS_URL is set — use 'celery -A celery_app.app worker' and "
            "'celery -A celery_app.app beat' instead of python -m workers"
        )
    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)
    start_scheduler()
    logger.info("FlowDesk worker running — press Ctrl+C to stop")
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        _handle_shutdown(signal.SIGINT, None)


if __name__ == "__main__":
    main()
