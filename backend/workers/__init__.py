"""Background job scheduler for FlowDesk (sibling to the `app` HTTP package).

Dedicated worker process (production):

    python -m workers

API co-located scheduler (single-instance dev):

    SCHEDULER_ENABLED=true  # started from app.main lifespan
"""
import workers.bootstrap  # noqa: F401 — register all ORM models on package import

from workers.scheduler import shutdown_scheduler, start_scheduler

__all__ = ["shutdown_scheduler", "start_scheduler"]
