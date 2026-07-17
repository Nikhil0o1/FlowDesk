"""Celery application instance.

CLI:
    celery -A celery_app.app worker -Q default,scheduled,fast --loglevel=info
    celery -A celery_app.app beat --loglevel=info
"""
from celery_app.factory import create_celery_app

app = create_celery_app()

import celery_app.tasks  # noqa: E402, F401 — register task modules

celery_app = app
