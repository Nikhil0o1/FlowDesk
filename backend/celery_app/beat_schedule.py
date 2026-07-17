"""Build Celery Beat schedule from workers.schedule_config."""
from celery.schedules import crontab
from celery.schedules import schedule as interval_schedule

from workers.schedule_config import CronSpec, IntervalSpec, JOB_SCHEDULES


def build_celery_beat_schedule() -> dict:
    beat: dict = {}
    for name, spec in JOB_SCHEDULES.items():
        if isinstance(spec, CronSpec):
            celery_schedule = crontab(hour=spec.hour, minute=spec.minute)
        else:
            seconds = spec.minutes * 60 + spec.hours * 3600
            if seconds <= 0:
                continue
            celery_schedule = interval_schedule(run_every=seconds)
        beat[name] = {
            "task": "flowdesk.run_scheduled_job",
            "schedule": celery_schedule,
            "args": (name,),
            "options": {"queue": "scheduled"},
        }
    return beat
