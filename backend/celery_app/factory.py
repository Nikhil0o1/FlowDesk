"""Production Celery application factory."""
from celery import Celery

from app.core.config import settings


def create_celery_app() -> Celery:
    celery = Celery("flowdesk")

    if settings.celery_configured:
        celery.config_from_object("celery_app.config")
    else:
        celery.conf.update(
            broker_url="memory://",
            result_backend="cache+memory://",
            task_always_eager=True,
            task_store_eager_result=True,
        )

    import celery_app.signals  # noqa: F401 — worker ORM bootstrap

    return celery
