"""Production Celery configuration."""
from app.core.config import settings
from celery_app.beat_schedule import build_celery_beat_schedule

# Broker & results
broker_url = settings.REDIS_URL
result_backend = settings.REDIS_URL
result_expires = settings.CELERY_RESULT_EXPIRES

# Connection resilience (Celery 6+ uses broker_connection_retry_on_startup)
broker_connection_retry = True
broker_connection_retry_on_startup = True
broker_connection_max_retries = 10

broker_transport_options = {
    "visibility_timeout": settings.CELERY_TASK_TIME_LIMIT + 300,
    "socket_timeout": 5,
    "socket_connect_timeout": 5,
}

# Serialization
timezone = "UTC"
enable_utc = True
task_serializer = "json"
result_serializer = "json"
accept_content = ["json"]

# Worker behaviour
task_track_started = True
task_acks_late = True
worker_prefetch_multiplier = 1
worker_concurrency = settings.CELERY_WORKER_CONCURRENCY
task_time_limit = settings.CELERY_TASK_TIME_LIMIT
task_soft_time_limit = settings.CELERY_TASK_SOFT_TIME_LIMIT

# Queues
task_default_queue = "default"
task_queues = {
    "default": {"exchange": "default", "routing_key": "default"},
    "scheduled": {"exchange": "scheduled", "routing_key": "scheduled"},
    "fast": {"exchange": "fast", "routing_key": "fast"},
}

task_routes = {
    "flowdesk.run_scheduled_job": {"queue": "scheduled"},
    "flowdesk.ping": {"queue": "fast"},
    "flowdesk.deliver_webhook": {"queue": "default"},
}

# Beat
beat_schedule = build_celery_beat_schedule()
beat_schedule_filename = settings.CELERY_BEAT_SCHEDULE_FILE

imports = ("celery_app.tasks",)

task_annotations = {
    "flowdesk.run_scheduled_job": {
        "max_retries": 3,
        "default_retry_delay": 60,
    },
}
