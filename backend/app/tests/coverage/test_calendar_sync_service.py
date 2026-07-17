"""Coverage — Google Calendar sync service."""
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.services import calendar_sync_service as cal
from app.tests.helpers import add_task, build_project_stack, seed_google_connection


@pytest.mark.coverage
@patch("app.services.calendar_sync_service.google_service.calendar_create_event")
def test_push_task_all_day(mock_create, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_google_connection(db, owner)
    task = add_task(db, project, owner, title="Due task", number=1)
    task.due_date = date.today()
    mock_create.return_value = {"id": "evt-1", "link": "https://cal/1"}
    db.flush()

    link = cal.push_task(db, owner, project, task)
    assert link == "https://cal/1"
    assert task.google_calendar_event_id == "evt-1"


@pytest.mark.coverage
@patch("app.services.calendar_sync_service.google_service.calendar_create_timed_event")
def test_push_task_timed(mock_create, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_google_connection(db, owner)
    task = add_task(db, project, owner, title="Timed", number=2)
    start = datetime.now(timezone.utc)
    task.planned_start_at = start
    task.planned_end_at = start + timedelta(hours=1)
    mock_create.return_value = {"id": "evt-2", "link": "https://cal/2"}
    db.flush()

    assert cal.push_task(db, owner, project, task) == "https://cal/2"


@pytest.mark.coverage
def test_push_task_no_dates_returns_none(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_google_connection(db, owner)
    task = add_task(db, project, owner, title="No date", number=3)
    db.flush()
    assert cal.push_task(db, owner, project, task) is None


@pytest.mark.coverage
@patch("app.services.calendar_sync_service.google_service.calendar_update_event")
def test_refresh_task_updates_event(mock_update, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_google_connection(db, owner)
    task = add_task(db, project, owner, title="Refresh", number=4)
    task.google_calendar_event_id = "evt-old"
    db.flush()
    cal.refresh_task(db, owner, project, task)
    mock_update.assert_called_once()


@pytest.mark.coverage
@patch("app.services.calendar_sync_service.google_service.calendar_delete_event")
def test_remove_task_deletes_event(mock_delete, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_google_connection(db, owner)
    task = add_task(db, project, owner, title="Remove", number=5)
    task.google_calendar_event_id = "evt-del"
    db.flush()
    cal.remove_task(db, owner, task)
    mock_delete.assert_called_once()
    assert task.google_calendar_event_id is None


@pytest.mark.coverage
def test_push_task_requires_calendar_scope(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="No conn", number=6)
    task.due_date = date.today()
    db.flush()
    with pytest.raises(HTTPException) as exc:
        cal.push_task(db, owner, project, task)
    assert exc.value.status_code == 412
