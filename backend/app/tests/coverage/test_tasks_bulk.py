"""Integration-style coverage — archive, reorder, duplicate, time entries."""
from datetime import datetime, timedelta, timezone

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


def _past_range(hours: float = 0.5):
    end = datetime.now(timezone.utc) - timedelta(hours=1)
    start = end - timedelta(hours=hours)
    return start.isoformat(), end.isoformat()


@pytest.mark.integration
@pytest.mark.coverage
def test_task_archive_and_list_with_include_archived(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Archive me", number=50)
    headers = auth_headers(client, owner.email)

    archived = client.patch(f"/api/v1/tasks/{task.id}", headers=headers, json={"is_archived": True})
    assert archived.status_code == 200
    assert archived.json()["is_archived"] is True

    hidden = client.get(f"/api/v1/projects/{project.id}/tasks", headers=headers)
    assert all(t["id"] != str(task.id) for t in hidden.json()["items"])

    shown = client.get(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        params={"include_archived": "true"},
    )
    assert any(t["id"] == str(task.id) for t in shown.json()["items"])


@pytest.mark.integration
@pytest.mark.coverage
def test_task_reorder_via_position(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    first = add_task(db, project, owner, title="First", number=51)
    second = add_task(db, project, owner, title="Second", number=52)
    first.position = 100
    second.position = 200
    db.flush()
    headers = auth_headers(client, owner.email)

    moved = client.patch(f"/api/v1/tasks/{second.id}", headers=headers, json={"position": 50})
    assert moved.status_code == 200
    assert moved.json()["position"] == 50


@pytest.mark.integration
@pytest.mark.coverage
def test_duplicate_task_and_time_entries(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    src = add_task(db, project, owner, title="Original", number=53)
    headers = auth_headers(client, owner.email)
    started, ended = _past_range()

    dup = client.post(f"/api/v1/tasks/{src.id}/duplicate", headers=headers)
    assert dup.status_code == 201
    assert dup.json()["title"] == "Original (copy)"
    assert dup.json()["number"] != src.number

    entry = client.post(
        f"/api/v1/tasks/{src.id}/time-entries",
        headers=headers,
        json={"started_at": started, "ended_at": ended, "description": "Logged on source"},
    )
    assert entry.status_code == 201

    listed = client.get(f"/api/v1/tasks/{src.id}/time-entries", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1
    assert listed.json()["items"][0]["description"] == "Logged on source"
