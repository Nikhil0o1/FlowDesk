"""Coverage — task API extended filters, assignees, checklists, custom fields, subtasks."""
from datetime import date, timedelta

import pytest

from app.models.organization import OrganizationMember
from app.models.task import TaskAssignee
from app.models.workspace import WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, add_task, build_project_stack


@pytest.mark.coverage
def test_my_tasks_empty_when_no_projects(client, db, org):
    outsider = make_user(db, "no-proj@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=outsider.id, role="member"))
    db.flush()
    headers = auth_headers(client, outsider.email)

    response = client.get("/api/v1/me/tasks", headers=headers)
    assert response.status_code == 200
    assert response.json()["total"] == 0


@pytest.mark.coverage
def test_my_tasks_due_from_to_and_include_completed(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYT")
    today = date.today()
    done = add_task(db, project, owner, title="Done task", number=1)
    done.completed_at = done.created_at
    done.due_date = today - timedelta(days=1)
    open_task = add_task(db, project, owner, title="Open range", number=2)
    open_task.due_date = today + timedelta(days=2)
    db.add(TaskAssignee(task_id=open_task.id, user_id=owner.id))
    db.flush()
    headers = auth_headers(client, owner.email)

    ranged = client.get(
        "/api/v1/me/tasks",
        headers=headers,
        params={
            "relation": "assigned",
            "due_from": today.isoformat(),
            "due_to": (today + timedelta(days=7)).isoformat(),
        },
    )
    assert ranged.status_code == 200
    assert any(t["title"] == "Open range" for t in ranged.json()["items"])

    completed = client.get(
        "/api/v1/me/tasks",
        headers=headers,
        params={"relation": "created", "include_completed": True},
    )
    assert completed.json()["total"] >= 2


@pytest.mark.coverage
def test_create_subtask_and_reject_nested(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    parent = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Parent", "priority": "normal", "task_type": "task"},
    ).json()
    sub = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={
            "title": "Sub",
            "priority": "normal",
            "task_type": "task",
            "parent_task_id": parent["id"],
        },
    )
    assert sub.status_code == 201

    nested = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={
            "title": "Too deep",
            "priority": "normal",
            "task_type": "task",
            "parent_task_id": sub.json()["id"],
        },
    )
    assert nested.status_code == 400


@pytest.mark.coverage
def test_remove_assignee_and_duplicate_dependency(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "assignee-rm@test.dev")
    task = add_task(db, project, owner, title="Assign", number=1)
    blocker = add_task(db, project, owner, title="Block", number=2)
    headers = auth_headers(client, owner.email)

    client.post(
        f"/api/v1/tasks/{task.id}/assignees",
        headers=headers,
        json={"user_ids": [str(member.id)]},
    )
    removed = client.delete(f"/api/v1/tasks/{task.id}/assignees/{member.id}", headers=headers)
    assert removed.status_code == 200

    client.post(
        f"/api/v1/tasks/{task.id}/dependencies",
        headers=headers,
        json={"depends_on_task_id": str(blocker.id)},
    )
    dup = client.post(
        f"/api/v1/tasks/{task.id}/dependencies",
        headers=headers,
        json={"depends_on_task_id": str(blocker.id)},
    )
    assert dup.status_code == 409


@pytest.mark.coverage
def test_checklist_update_and_custom_field_patch(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Meta", number=3)
    headers = auth_headers(client, owner.email)

    cl = client.post(
        f"/api/v1/tasks/{task.id}/checklists",
        headers=headers,
        json={"name": "Steps"},
    ).json()
    renamed = client.patch(
        f"/api/v1/checklists/{cl['id']}",
        headers=headers,
        json={"name": "Launch steps"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Launch steps"

    field = client.post(
        f"/api/v1/projects/{project.id}/custom-fields",
        headers=headers,
        json={"name": "Severity", "field_type": "text"},
    ).json()
    patched = client.patch(
        f"/api/v1/custom-fields/{field['id']}",
        headers=headers,
        json={"name": "Priority level"},
    )
    assert patched.status_code == 200


@pytest.mark.coverage
def test_list_tasks_with_sprint_and_status_filters(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="LST")
    headers = auth_headers(client, owner.email)
    status = client.post(
        f"/api/v1/projects/{project.id}/statuses",
        headers=headers,
        json={"name": "Todo", "color": "#ccc", "category": "todo"},
    ).json()
    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Filter sprint", "project_id": str(project.id)},
    ).json()
    task = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Sprint scoped", "priority": "high", "task_type": "bug", "status_id": status["id"]},
    ).json()
    client.post(
        f"/api/v1/sprints/{sprint['id']}/tasks",
        headers=headers,
        json={"task_ids": [task["id"]]},
    )

    filtered = client.get(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        params={
            "status_id": status["id"],
            "sprint_id": sprint["id"],
            "task_type": "bug",
            "priority": "high",
            "created_by": str(owner.id),
        },
    )
    assert filtered.status_code == 200
    assert len(filtered.json()["items"]) == 1


@pytest.mark.coverage
def test_create_task_accepts_past_schedule_dates(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    past = date.today() - timedelta(days=3)

    due_resp = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Past due", "due_date": past.isoformat()},
    )
    assert due_resp.status_code == 201, due_resp.text

    start_resp = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Past start", "start_date": past.isoformat()},
    )
    assert start_resp.status_code == 201, start_resp.text

    task = add_task(db, project, owner, title="Schedulable", number=50)
    patch_resp = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"due_date": past.isoformat()},
    )
    assert patch_resp.status_code == 200, patch_resp.text

    patch_resp = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"start_date": past.isoformat()},
    )
    assert patch_resp.status_code == 200, patch_resp.text
