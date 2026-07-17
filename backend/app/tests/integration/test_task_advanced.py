"""Integration — task dependencies, recurring tasks, and checklists."""
from datetime import datetime, timedelta, timezone

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


@pytest.mark.integration
def test_task_dependency_add_and_remove(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    blocker = add_task(db, project, owner, title="Blocker", number=1)
    blocked = add_task(db, project, owner, title="Blocked", number=2)

    add = client.post(
        f"/api/v1/tasks/{blocked.id}/dependencies",
        headers=headers,
        json={"depends_on_task_id": str(blocker.id)},
    )
    assert add.status_code == 201, add.text

    detail = client.get(f"/api/v1/tasks/{blocked.id}", headers=headers)
    assert detail.status_code == 200
    deps = detail.json().get("dependencies") or []
    assert len(deps) == 1
    dep_id = deps[0]["id"]

    remove = client.delete(f"/api/v1/tasks/{blocked.id}/dependencies/{dep_id}", headers=headers)
    assert remove.status_code == 200


@pytest.mark.integration
def test_task_dependency_rejects_self(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Solo", number=3)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/tasks/{task.id}/dependencies",
        headers=headers,
        json={"depends_on_task_id": str(task.id)},
    )
    assert response.status_code == 400


@pytest.mark.integration
def test_recurring_task_create_and_disable(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    next_at = datetime.now(timezone.utc) + timedelta(days=1)

    create = client.post(
        f"/api/v1/projects/{project.id}/recurring-tasks",
        headers=headers,
        json={
            "frequency": "weekly",
            "interval": 1,
            "template": {"title": "Weekly standup prep"},
            "next_occurrence_at": next_at.isoformat(),
        },
    )
    assert create.status_code == 201, create.text
    rec_id = create.json()["id"]

    listed = client.get(f"/api/v1/projects/{project.id}/recurring-tasks", headers=headers)
    assert listed.status_code == 200
    assert any(r["id"] == rec_id for r in listed.json())

    disable = client.delete(f"/api/v1/recurring-tasks/{rec_id}", headers=headers)
    assert disable.status_code == 200


@pytest.mark.integration
def test_task_checklist_lifecycle(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Checklist task", number=5)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/tasks/{task.id}/checklists",
        headers=headers,
        json={"name": "Launch checklist"},
    )
    assert create.status_code == 201
    checklist_id = create.json()["id"]

    item = client.post(
        f"/api/v1/checklists/{checklist_id}/items",
        headers=headers,
        json={"content": "Deploy API"},
    )
    assert item.status_code == 201
    item_id = item.json()["id"]

    done = client.patch(
        f"/api/v1/checklist-items/{item_id}",
        headers=headers,
        json={"is_done": True},
    )
    assert done.status_code == 200
    assert done.json()["is_done"] is True

    listed = client.get(f"/api/v1/tasks/{task.id}/checklists", headers=headers)
    assert listed.status_code == 200
    assert listed.json()[0]["items"]

    delete_item = client.delete(f"/api/v1/checklist-items/{item_id}", headers=headers)
    assert delete_item.status_code == 200

    delete_checklist = client.delete(f"/api/v1/checklists/{checklist_id}", headers=headers)
    assert delete_checklist.status_code == 200

    empty = client.get(f"/api/v1/tasks/{task.id}/checklists", headers=headers)
    assert empty.status_code == 200
    assert empty.json() == []
