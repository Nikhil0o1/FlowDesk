"""Celery worker lifecycle hooks."""
from celery.signals import worker_process_init


@worker_process_init.connect
def _bootstrap_worker_process(**_kwargs) -> None:
    """Register SQLAlchemy models once per worker child process."""
    import workers.bootstrap  # noqa: F401
