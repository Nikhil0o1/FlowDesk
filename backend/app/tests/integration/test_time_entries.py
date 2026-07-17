"""Phase 3 integration — time tracking (timer + manual entries)."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.time_entry import TimeEntry
from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


def _past_range(hours: float = 1.0):
    end = datetime.now(timezone.utc) - timedelta(hours=1)
    start = end - timedelta(hours=hours)
    return start.isoformat(), end.isoformat()


@pytest.mark.integration
def test_timer_start_stop_flow(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    start = client.post(
        f"/api/v1/tasks/{task.id}/timer/start",
        headers=headers,
        json={"description": "Working"},
    )
    assert start.status_code == 201, start.text
    entry_id = start.json()["id"]

    current = client.get("/api/v1/timer/current", headers=headers)
    assert current.status_code == 200
    assert current.json()["id"] == entry_id

    stop = client.post("/api/v1/timer/stop", headers=headers)
    assert stop.status_code == 200
    assert stop.json()["ended_at"] is not None
    assert stop.json()["duration_seconds"] is not None


@pytest.mark.integration
def test_cannot_start_two_timers(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task1 = add_task(db, project, owner, number=1)
    task2 = add_task(db, project, owner, title="T2", number=2)
    headers = auth_headers(client, owner.email)

    assert client.post(
        f"/api/v1/tasks/{task1.id}/timer/start", headers=headers, json={}
    ).status_code == 201
    conflict = client.post(
        f"/api/v1/tasks/{task2.id}/timer/start", headers=headers, json={}
    )
    assert conflict.status_code == 409


@pytest.mark.integration
def test_manual_time_entry_and_list(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)
    started, ended = _past_range(0.5)

    create = client.post(
        f"/api/v1/tasks/{task.id}/time-entries",
        headers=headers,
        json={"started_at": started, "ended_at": ended, "description": "Manual work"},
    )
    assert create.status_code == 201, create.text
    assert create.json()["is_manual"] is True

    listed = client.get(f"/api/v1/tasks/{task.id}/time-entries", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1


@pytest.mark.integration
def test_manual_entry_rejects_future_range(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)
    future = datetime.now(timezone.utc) + timedelta(days=1)

    response = client.post(
        f"/api/v1/tasks/{task.id}/time-entries",
        headers=headers,
        json={
            "started_at": future.isoformat(),
            "ended_at": (future + timedelta(hours=1)).isoformat(),
        },
    )
    assert response.status_code == 422


@pytest.mark.integration
def test_delete_own_time_entry(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)
    started, ended = _past_range(0.25)

    create = client.post(
        f"/api/v1/tasks/{task.id}/time-entries",
        headers=headers,
        json={"started_at": started, "ended_at": ended},
    )
    entry_id = create.json()["id"]

    delete = client.delete(f"/api/v1/time-entries/{entry_id}", headers=headers)
    assert delete.status_code == 200
    assert db.get(TimeEntry, entry_id) is None
