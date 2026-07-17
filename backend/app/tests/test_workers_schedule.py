"""Tests for shared job schedule registry and Celery wiring."""
from celery_app.beat_schedule import build_celery_beat_schedule
from celery_app.config import beat_schedule_filename, task_routes
from workers.registry import get_job, job_definitions, job_names


def test_job_registry_has_expected_jobs():
    names = job_names()
    assert len(names) == 15
    assert len(job_definitions()) == 15
    assert "pat_apply_delayed_revocations" in names
    assert "webhook_delivery_reconciliation" in names
    assert "webhook_delivery_purge" in names


def test_every_scheduled_job_has_callable():
    for name in job_names():
        assert get_job(name) is not None


def test_celery_beat_matches_registry():
    beat = build_celery_beat_schedule()
    assert set(beat.keys()) == set(job_names())
    for entry in beat.values():
        assert entry["task"] == "flowdesk.run_scheduled_job"
        assert entry["options"]["queue"] == "scheduled"


def test_celery_production_config():
    assert task_routes["flowdesk.run_scheduled_job"]["queue"] == "scheduled"
    assert beat_schedule_filename


def test_run_logged_propagate_reraises(monkeypatch):
    from workers import runner

    class Boom(Exception):
        pass

    def boom(_db):
        raise Boom("fail")

    monkeypatch.setattr(runner, "SessionLocal", lambda: _FakeSession())

    raised = False
    try:
        runner.run_logged("test_job", boom, propagate=True)
    except Boom:
        raised = True
    assert raised


class _FakeSession:
    def add(self, _obj):
        pass

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass
