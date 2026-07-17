"""FlowDesk Celery package."""
from celery_app.app import app, celery_app

__all__ = ["app", "celery_app"]
