"""Health-check tasks for worker connectivity."""
from celery_app.app import app


@app.task(name="flowdesk.ping", queue="fast")
def ping() -> str:
    return "pong"
