"""Celery task package — import submodules so tasks register on app load."""
from celery_app.tasks import health, scheduled, webhooks  # noqa: F401
