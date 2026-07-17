"""Task API integration tests (CRUD, listing, access control)."""
from app.models.organization import OrganizationMember
from app.models.task import TaskAssignee
from app.models.workspace import WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, add_task, build_project_stack


def test_list_project_tasks(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    add_task(db, project, owner, title="Alpha", number=1)
    add_task(db, project, owner, title="Beta", number=2)
    headers = auth_headers(client, "owner@test.dev")

    response = client.get(f"/api/v1/projects/{project.id}/tasks", headers=headers)
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 2
    titles = {item["title"] for item in items}
    assert titles == {"Alpha", "Beta"}


def test_create_task_with_assignee(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "task-assignee@test.dev")
    headers = auth_headers(client, "owner@test.dev")

    response = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={
            "title": "Assigned task",
            "priority": "normal",
            "task_type": "task",
            "assignee_ids": [str(member.id)],
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["title"] == "Assigned task"
    assignee_ids = {a["id"] for a in body["assignees"]}
    assert str(member.id) in assignee_ids


def test_workspace_member_without_project_access_cannot_create_task(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    user = make_user(db, "outsider-task@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="member"))
    db.flush()
    headers = auth_headers(client, "outsider-task@test.dev")

    response = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Blocked", "priority": "low", "task_type": "task"},
    )
    assert response.status_code == 404


def test_me_tasks_lists_assigned_work(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "me-tasks@test.dev")
    task = add_task(db, project, owner, title="Mine", number=1)
    db.add(TaskAssignee(task_id=task.id, user_id=member.id, assigned_by=owner.id))
    db.flush()
    headers = auth_headers(client, "me-tasks@test.dev")

    response = client.get("/api/v1/me/tasks", headers=headers)
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "Mine"


def test_duplicate_task_creates_copy(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    created = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Original", "priority": "high", "task_type": "bug"},
    )
    assert created.status_code == 201
    task_id = created.json()["id"]

    dup = client.post(f"/api/v1/tasks/{task_id}/duplicate", headers=headers)
    assert dup.status_code == 201, dup.text
    copy = dup.json()
    assert copy["id"] != task_id
    assert copy["title"].startswith("Original")
    assert copy["ref"] != created.json()["ref"]
