"""Integration — My Tasks summary, personal list, delegated relation."""
from datetime import date, timedelta

import pytest

from app.models.task import TaskAssignee
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack


@pytest.mark.integration
def test_my_tasks_summary_counts(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    today = date.today()

    task_today = add_task(db, project, owner, title="Due today", number=1)
    task_today.due_date = today
    task_overdue = add_task(db, project, owner, title="Overdue", number=2)
    task_overdue.due_date = today - timedelta(days=2)
    task_next = add_task(db, project, owner, title="Next week", number=3)
    task_next.due_date = today + timedelta(days=3)
    task_open = add_task(db, project, owner, title="No due", number=4)
    task_open.due_date = None
    for task in (task_today, task_overdue, task_next, task_open):
        db.add(TaskAssignee(task_id=task.id, user_id=owner.id))
    db.flush()

    response = client.get(
        f"/api/v1/me/tasks/summary?workspace_id={workspace.id}",
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["today"] == 1
    assert body["overdue"] == 1
    assert body["today_and_overdue"] == 2
    assert body["next"] == 1
    assert body["unscheduled"] == 1


@pytest.mark.integration
def test_personal_list_get_or_create(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    first = client.get(f"/api/v1/me/personal-list?workspace_id={workspace.id}", headers=headers)
    assert first.status_code == 200
    project_id = first.json()["id"]
    assert first.json()["is_personal"] is True

    second = client.get(f"/api/v1/me/personal-list?workspace_id={workspace.id}", headers=headers)
    assert second.status_code == 200
    assert second.json()["id"] == project_id

    task = client.post(
        f"/api/v1/projects/{project_id}/tasks",
        headers=headers,
        json={"title": "Private errand"},
    )
    assert task.status_code == 201

    assigned = client.get(
        f"/api/v1/me/tasks?relation=assigned&workspace_id={workspace.id}",
        headers=headers,
    )
    assert assigned.status_code == 200
    assert assigned.json()["total"] == 0


@pytest.mark.integration
def test_my_tasks_delegated_relation(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "member@test.dev")
    headers = auth_headers(client, owner.email)

    task = add_task(db, project, owner, title="Delegated work", number=1)
    db.add(TaskAssignee(task_id=task.id, user_id=member.id))
    db.flush()

    response = client.get(
        f"/api/v1/me/tasks?relation=delegated&workspace_id={workspace.id}",
        headers=headers,
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "Delegated work"
