import uuid

from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space
from app.models.task import Task
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user


def _build_workspace(db, org, owner):
    workspace = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=workspace.id, name="Space", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(
        space_id=space.id, workspace_id=workspace.id, name="Proj", key="PRJ", created_by=owner.id
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role="admin"))
    task = Task(project_id=project.id, number=1, title="Secret task", created_by=owner.id)
    project.next_task_number = 2
    db.add(task)
    db.flush()
    return workspace, project, task


def test_superadmin_sees_org_metadata_but_not_tasks(client, db, org, owner, superadmin):
    _ws, project, task = _build_workspace(db, org, owner)
    headers = auth_headers(client, "super@test.dev")

    # Metadata: allowed
    orgs = client.get("/api/v1/admin/organizations", headers=headers)
    assert orgs.status_code == 200
    assert orgs.json()["total"] >= 1

    # Org-private data: denied (404 — resource invisible)
    tasks = client.get(f"/api/v1/projects/{project.id}/tasks", headers=headers)
    assert tasks.status_code == 404
    detail = client.get(f"/api/v1/tasks/{task.id}", headers=headers)
    assert detail.status_code == 404


def test_superadmin_can_disable_org(client, db, org, owner, superadmin):
    headers = auth_headers(client, "super@test.dev")
    response = client.post(f"/api/v1/admin/organizations/{org.id}/disable", headers=headers)
    assert response.status_code == 200

    # Disabled org blocks members
    owner_headers = auth_headers(client, "owner@test.dev")
    blocked = client.get(f"/api/v1/organizations/{org.id}", headers=owner_headers)
    assert blocked.status_code == 403


def test_non_superadmin_cannot_access_admin_api(client, owner):
    headers = auth_headers(client, "owner@test.dev")
    assert client.get("/api/v1/admin/organizations", headers=headers).status_code == 403


def test_outsider_cannot_see_workspace(client, db, org, owner):
    workspace, project, _task = _build_workspace(db, org, owner)
    outsider = make_user(db, "outsider@test.dev")
    headers = auth_headers(client, "outsider@test.dev")

    assert client.get(f"/api/v1/workspaces/{workspace.id}", headers=headers).status_code == 404
    assert client.get(f"/api/v1/projects/{project.id}/tasks", headers=headers).status_code == 404


def test_member_sees_only_assigned_projects(client, db, org, owner):
    workspace, project, _task = _build_workspace(db, org, owner)
    member = make_user(db, "member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, "member@test.dev")

    # workspace member without project membership: project list is empty
    listing = client.get(f"/api/v1/workspaces/{workspace.id}/projects", headers=headers)
    assert listing.status_code == 200
    assert listing.json() == []
    # direct access denied
    assert client.get(f"/api/v1/projects/{project.id}", headers=headers).status_code == 404

    # once added as project member, access works
    db.add(ProjectMember(project_id=project.id, user_id=member.id, role="member"))
    db.flush()
    assert client.get(f"/api/v1/projects/{project.id}", headers=headers).status_code == 200


def test_workspace_member_cannot_delete_workspace(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    admin = make_user(db, "wsadmin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=admin.id, role="admin"))
    db.flush()

    # workspace admin (not org owner) cannot delete the workspace
    headers = auth_headers(client, "wsadmin@test.dev")
    assert client.delete(f"/api/v1/workspaces/{workspace.id}", headers=headers).status_code == 403

    # org owner can
    owner_headers = auth_headers(client, "owner@test.dev")
    assert client.delete(f"/api/v1/workspaces/{workspace.id}", headers=owner_headers).status_code == 200


def test_task_crud_with_permissions(client, db, org, owner):
    _ws, project, _task = _build_workspace(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    created = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "New task", "priority": "high", "task_type": "bug"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["ref"].startswith("PRJ-")
    assert body["priority"] == "high"

    updated = client.patch(
        f"/api/v1/tasks/{body['id']}", headers=headers, json={"title": "Renamed"}
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Renamed"

    deleted = client.delete(f"/api/v1/tasks/{body['id']}", headers=headers)
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/tasks/{body['id']}", headers=headers).status_code == 404
