"""Celery task registration smoke tests (runs eager — no Redis required)."""
from celery_app.app import app as celery_app
from celery_app.beat_schedule import build_celery_beat_schedule
from workers.registry import job_names
from workers.schedule_config import JOB_SCHEDULES


def test_celery_beat_schedule_registered():
    schedule = build_celery_beat_schedule()
    for name in job_names():
        assert name in schedule
    assert schedule["due_date_reminders"]["task"] == "flowdesk.run_scheduled_job"
    assert len(schedule) == len(JOB_SCHEDULES)


def test_celery_tasks_registered():
    names = {
        "flowdesk.run_scheduled_job",
        "flowdesk.ping",
    }
    registered = set(celery_app.tasks.keys())
    missing = names - registered
    assert not missing, f"Missing tasks: {missing}"


def test_scheduled_job_runs_eager():
    from celery_app.tasks.scheduled import run_scheduled_job

    # conftest sets CELERY_TASK_ALWAYS_EAGER=true
    run_scheduled_job.delay("cleanup_expired_invites")
