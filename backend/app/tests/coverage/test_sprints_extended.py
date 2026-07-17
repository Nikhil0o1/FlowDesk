"""Coverage — sprint dates, burndown, board tasks, delete, rollover, standups."""
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack


@pytest.mark.coverage
def test_sprint_create_rejects_invalid_dates(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    today = date.today()

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Bad dates", "start_date": today.isoformat(), "end_date": today.isoformat()},
    )
    assert response.status_code == 422

    past = today - timedelta(days=2)
    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={
            "name": "Past sprint",
            "start_date": past.isoformat(),
            "end_date": (today + timedelta(days=7)).isoformat(),
        },
    )
    assert response.status_code == 422

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={
            "name": "Past end",
            "start_date": today.isoformat(),
            "end_date": past.isoformat(),
        },
    )
    assert response.status_code == 422


@pytest.mark.coverage
@patch("app.api.v1.sprints.email_service")
def test_sprint_burndown_and_board(_mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    start = date.today()
    end = start + timedelta(days=4)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={
            "name": "Velocity Sprint",
            "project_id": str(project.id),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        },
    )
    assert sprint.status_code == 201
    sprint_id = sprint.json()["id"]

    task = add_task(db, project, owner, title="SP task", number=90)
    task.story_points = 5
    task.completed_at = datetime.now(timezone.utc)
    db.flush()
    client.post(f"/api/v1/sprints/{sprint_id}/tasks", headers=headers, json={"task_ids": [str(task.id)]})

    board = client.get(f"/api/v1/sprints/{sprint_id}/tasks", headers=headers)
    assert board.status_code == 200
    assert len(board.json()) == 1

    burndown = client.get(f"/api/v1/sprints/{sprint_id}/burndown", headers=headers)
    assert burndown.status_code == 200
    data = burndown.json()
    assert data["total_points"] == 5
    assert data["completed_points"] == 5
    assert len(data["points"]) == (end - start).days + 1
    assert data["points"][0]["day"] == start.isoformat()
    assert data["points"][-1]["day"] == end.isoformat()


@pytest.mark.coverage
@patch("app.api.v1.sprints.email_service")
def test_sprint_complete_rollover_and_cancel(_mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    active = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Active", "project_id": str(project.id)},
    ).json()["id"]
    target = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Next", "project_id": str(project.id)},
    ).json()["id"]

    done = add_task(db, project, owner, title="Done", number=91)
    open_task = add_task(db, project, owner, title="Open", number=92)
    client.post(f"/api/v1/sprints/{active}/tasks", headers=headers, json={"task_ids": [str(done.id), str(open_task.id)]})
    done.completed_at = datetime.now(timezone.utc)
    db.flush()

    client.post(f"/api/v1/sprints/{active}/start", headers=headers)
    complete = client.post(
        f"/api/v1/sprints/{active}/complete",
        headers=headers,
        json={"move_incomplete_to": target},
    )
    assert complete.status_code == 200
    assert complete.json()["sprint"]["status"] == "completed"

    planned = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "To cancel"},
    )
    cancel = client.delete(f"/api/v1/sprints/{planned.json()['id']}", headers=headers)
    assert cancel.status_code == 200


@pytest.mark.coverage
@patch("app.api.v1.sprints.email_service")
def test_sprint_standup_and_task_sprints(_mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "scrum@test.dev")
    headers = auth_headers(client, owner.email)
    today = date.today()

    sprint_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Standup Sprint", "scrum_master_id": str(member.id)},
    ).json()["id"]
    task = add_task(db, project, owner, title="Linked", number=93)
    client.post(f"/api/v1/sprints/{sprint_id}/tasks", headers=headers, json={"task_ids": [str(task.id)]})

    standup = client.post(
        f"/api/v1/sprints/{sprint_id}/standups",
        headers=auth_headers(client, member.email),
        json={"for_date": today.isoformat(), "today": "Ship burndown", "yesterday": "Tests"},
    )
    assert standup.status_code == 201

    listed = client.get(f"/api/v1/sprints/{sprint_id}/standups", headers=headers, params={"for_date": today.isoformat()})
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1

    task_sprints = client.get(f"/api/v1/tasks/{task.id}/sprints", headers=headers)
    assert task_sprints.status_code == 200
    assert any(s["id"] == sprint_id for s in task_sprints.json())
