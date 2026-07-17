"""Phase 5 regression — release-critical product workflows."""
import pytest

from app.services.notification_service import notify
from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


@pytest.mark.regression
def test_workspace_and_project_access_smoke(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    workspaces = client.get(f"/api/v1/organizations/{org.id}/workspaces", headers=headers)
    assert workspaces.status_code == 200
    assert any(w["id"] == str(workspace.id) for w in workspaces.json())

    detail = client.get(f"/api/v1/projects/{project.id}", headers=headers)
    assert detail.status_code == 200


@pytest.mark.regression
def test_task_create_and_fetch_smoke(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Release smoke task", "priority": "normal", "task_type": "task"},
    )
    assert create.status_code == 201, create.text
    task_id = create.json()["id"]

    detail = client.get(f"/api/v1/tasks/{task_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["title"] == "Release smoke task"

    listed = client.get(f"/api/v1/projects/{project.id}/tasks", headers=headers)
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert any(t["id"] == task_id for t in items)


@pytest.mark.regression
def test_search_smoke(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    add_task(db, project, owner, title="RegressionSearchMarker", number=88)
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/search", headers=headers, params={"q": "RegressionSearchMarker"})
    assert response.status_code == 200
    tasks = response.json().get("tasks") or []
    assert any("RegressionSearchMarker" in (t.get("title") or "") for t in tasks)


@pytest.mark.regression
def test_notifications_inbox_smoke(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    notify(
        db,
        owner.id,
        "regression_ping",
        "Regression ping",
        "Smoke notification",
        workspace_id=workspace.id,
        project_id=project.id,
    )
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/notifications", headers=headers)
    assert response.status_code == 200
    assert response.json()["total"] >= 1
    assert response.json()["items"]


@pytest.mark.regression
def test_user_profile_smoke(client, owner):
    headers = auth_headers(client, owner.email)

    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["email"] == owner.email

    patch = client.patch(
        "/api/v1/users/me/profile",
        headers=headers,
        json={"full_name": "Release Owner"},
    )
    assert patch.status_code == 200
    assert patch.json()["profile"]["full_name"] == "Release Owner"
