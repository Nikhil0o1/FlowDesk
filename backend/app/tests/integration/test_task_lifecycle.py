"""Phase 3 integration — task lifecycle and share members."""
import pytest
from sqlalchemy import select

from app.models.notification import Notification
from app.models.task import TaskShareMember
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack


@pytest.mark.integration
def test_task_create_update_delete(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Lifecycle task", "priority": "normal", "task_type": "task"},
    )
    assert create.status_code == 201, create.text
    task_id = create.json()["id"]

    patch = client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=headers,
        json={"title": "Updated lifecycle", "priority": "high"},
    )
    assert patch.status_code == 200
    assert patch.json()["priority"] == "high"

    delete = client.delete(f"/api/v1/tasks/{task_id}", headers=headers)
    assert delete.status_code == 200


@pytest.mark.integration
def test_task_assignee_update(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "task-assign@test.dev")
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Assign me", "priority": "normal", "task_type": "task"},
    )
    task_id = create.json()["id"]

    assign = client.post(
        f"/api/v1/tasks/{task_id}/assignees",
        headers=headers,
        json={"user_ids": [str(member.id)]},
    )
    assert assign.status_code == 200

    detail = client.get(f"/api/v1/tasks/{task_id}", headers=headers)
    assert any(a["id"] == str(member.id) for a in detail.json()["assignees"])


@pytest.mark.integration
def test_task_share_add_and_remove_member(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "share-peer@test.dev")
    task = add_task(db, project, owner, title="Shared task")
    task.is_private = True
    db.flush()
    headers = auth_headers(client, owner.email)

    client.patch(
        f"/api/v1/tasks/{task.id}/share",
        headers=headers,
        json={"is_private": True},
    )

    add = client.post(
        f"/api/v1/tasks/{task.id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert add.status_code == 201, add.text
    assert any(m["user_id"] == str(member.id) for m in add.json()["members"])

    remove = client.delete(
        f"/api/v1/tasks/{task.id}/share/members/{member.id}",
        headers=headers,
    )
    assert remove.status_code == 200
    assert db.scalar(
        select(TaskShareMember).where(
            TaskShareMember.task_id == task.id, TaskShareMember.user_id == member.id
        )
    ) is None


@pytest.mark.integration
def test_duplicate_task(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Original")
    headers = auth_headers(client, owner.email)

    dup = client.post(f"/api/v1/tasks/{task.id}/duplicate", headers=headers)
    assert dup.status_code == 201
    assert "(copy)" in dup.json()["title"].lower()
    assert dup.json()["id"] != str(task.id)
