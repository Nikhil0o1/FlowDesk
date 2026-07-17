"""Sprint API integration tests."""
from datetime import date, timedelta

from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, build_project_stack
from app.models.organization import OrganizationMember
from app.models.workspace import WorkspaceMember


def test_sprint_crud_flow(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")
    start = date.today()
    end = start + timedelta(days=14)

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={
            "name": "Sprint 1",
            "goal": "Ship MVP",
            "project_id": str(project.id),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    sprint = created.json()
    assert sprint["name"] == "Sprint 1"
    assert sprint["status"] == "planned"

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/sprints", headers=headers)
    assert listed.status_code == 200
    assert any(s["id"] == sprint["id"] for s in listed.json())

    updated = client.patch(
        f"/api/v1/sprints/{sprint['id']}",
        headers=headers,
        json={"goal": "Ship v1"},
    )
    assert updated.status_code == 200
    assert updated.json()["goal"] == "Ship v1"

    deleted = client.delete(f"/api/v1/sprints/{sprint['id']}", headers=headers)
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/sprints/{sprint['id']}", headers=headers).status_code == 404


def test_workspace_member_cannot_create_sprint(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = make_user(db, "sprint-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, "sprint-member@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Blocked sprint", "project_id": str(project.id)},
    )
    assert response.status_code == 403


def test_add_task_to_sprint(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    task = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Sprint task", "priority": "normal", "task_type": "task"},
    )
    assert task.status_code == 201
    task_id = task.json()["id"]

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Active sprint", "project_id": str(project.id)},
    )
    assert sprint.status_code == 201
    sprint_id = sprint.json()["id"]

    linked = client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=headers,
        json={"task_ids": [task_id]},
    )
    assert linked.status_code == 200, linked.text

    tasks = client.get(f"/api/v1/sprints/{sprint_id}/tasks", headers=headers)
    assert tasks.status_code == 200
    assert len(tasks.json()) == 1
    assert tasks.json()[0]["id"] == task_id
