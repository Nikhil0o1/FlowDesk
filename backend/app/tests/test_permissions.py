import uuid

from sqlalchemy import select

from app.models.organization import OrganizationMember
from app.models.notification import Notification
from app.models.project import Project, ProjectMember, Space
from app.models.task import CustomStatus, Task, TaskAssignee
from app.models.workspace import Workspace, WorkspaceMember
from app.core.task_ref import format_task_ref
from app.tests.conftest import auth_headers, make_user, seed_login_otp


def _build_workspace(db, org, owner):
    workspace = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=workspace.id, name="Space", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(
        space_id=space.id, workspace_id=workspace.id, name="Proj", created_by=owner.id
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

    # Disabled org blocks member sign-in
    seed_login_otp(db, "owner@test.dev", "424242")
    blocked_login = client.post(
        "/api/v1/auth/otp/verify", json={"email": "owner@test.dev", "code": "424242"}
    )
    assert blocked_login.status_code == 403
    assert "disabled" in blocked_login.json()["detail"].lower()


def test_non_superadmin_cannot_access_admin_api(client, owner):
    headers = auth_headers(client, "owner@test.dev")
    assert client.get("/api/v1/admin/organizations", headers=headers).status_code == 403


def test_outsider_cannot_see_workspace(client, db, org, owner):
    workspace, project, _task = _build_workspace(db, org, owner)
    make_user(db, "outsider@test.dev")

    seed_login_otp(db, "outsider@test.dev", "424242")
    blocked_login = client.post(
        "/api/v1/auth/otp/verify", json={"email": "outsider@test.dev", "code": "424242"}
    )
    assert blocked_login.status_code == 403
    assert "permission" in blocked_login.json()["detail"].lower()


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


def test_project_member_can_only_change_assigned_task_status(client, db, org, owner):
    workspace, project, task = _build_workspace(db, org, owner)
    todo = CustomStatus(project_id=project.id, name="To do", category="todo", position=0)
    progress = CustomStatus(project_id=project.id, name="In progress", category="in_progress", position=1)
    db.add(todo)
    db.add(progress)
    assignee = make_user(db, "assigned-status@test.dev")
    other_member = make_user(db, "other-status@test.dev")
    for user in (assignee, other_member):
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="member"))
        db.add(ProjectMember(project_id=project.id, user_id=user.id, role="member"))
    db.flush()
    task.status_id = todo.id
    db.add(TaskAssignee(task_id=task.id, user_id=assignee.id, assigned_by=owner.id))
    db.flush()

    other_headers = auth_headers(client, "other-status@test.dev")
    blocked = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=other_headers,
        json={"status_id": str(progress.id)},
    )
    assert blocked.status_code == 403

    assignee_headers = auth_headers(client, "assigned-status@test.dev")
    moved = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=assignee_headers,
        json={"status_id": str(progress.id)},
    )
    assert moved.status_code == 200, moved.text


def test_project_member_cannot_manage_task_assignees(client, db, org, owner):
    workspace, project, task = _build_workspace(db, org, owner)
    member = make_user(db, "assignee-member@test.dev")
    target = make_user(db, "assignee-target@test.dev")
    for user in (member, target):
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="member"))
        db.add(ProjectMember(project_id=project.id, user_id=user.id, role="member"))
    db.add(TaskAssignee(task_id=task.id, user_id=member.id, assigned_by=owner.id))
    db.flush()
    headers = auth_headers(client, "assignee-member@test.dev")

    add_response = client.post(
        f"/api/v1/tasks/{task.id}/assignees",
        headers=headers,
        json={"user_ids": [str(target.id)]},
    )
    assert add_response.status_code == 403

    remove_response = client.delete(f"/api/v1/tasks/{task.id}/assignees/{member.id}", headers=headers)
    assert remove_response.status_code == 403

    owner_headers = auth_headers(client, "owner@test.dev")
    admin_response = client.post(
        f"/api/v1/tasks/{task.id}/assignees",
        headers=owner_headers,
        json={"user_ids": [str(target.id)]},
    )
    assert admin_response.status_code == 200, admin_response.text


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


def test_workspace_owner_can_promote_and_demote_admins_and_members(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    admin = make_user(db, "admin-target@test.dev")
    member = make_user(db, "member-target@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, "owner@test.dev")

    demoted = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{admin.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert demoted.status_code == 200, demoted.text
    promoted = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{member.id}",
        headers=headers,
        json={"role": "admin"},
    )
    assert promoted.status_code == 200, promoted.text

    assert db.scalar(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == admin.id,
        )
    ) == "member"
    assert db.scalar(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == member.id,
        )
    ) == "admin"
    assert db.scalar(
        select(Notification).where(
            Notification.user_id == member.id,
            Notification.type == "workspace_role_changed",
        )
    )


def test_workspace_owner_cannot_change_owner_roles(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    second_owner = make_user(db, "second-owner@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=second_owner.id, role="owner"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=second_owner.id, role="admin"))
    db.flush()
    headers = auth_headers(client, "owner@test.dev")

    response = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{second_owner.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert response.status_code == 403


def test_org_admin_can_demote_workspace_admin(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    org_admin = make_user(db, "org-admin-demote@test.dev")
    ws_admin = make_user(db, "ws-admin-demote@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()
    headers = auth_headers(client, org_admin.email)

    response = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{ws_admin.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert response.status_code == 200, response.text


def test_workspace_admin_can_demote_members_but_not_promote_or_modify_other_admins(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    admin = make_user(db, "role-admin@test.dev")
    other_admin = make_user(db, "other-admin@test.dev")
    member = make_user(db, "role-member@test.dev")
    for user in (admin, other_admin, member):
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=other_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, "role-admin@test.dev")

    promoted = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{member.id}",
        headers=headers,
        json={"role": "admin"},
    )
    assert promoted.status_code == 403

    demoted = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{other_admin.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert demoted.status_code == 403, demoted.text

    member_demoted = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{member.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert member_demoted.status_code == 200, member_demoted.text


def test_workspace_member_cannot_change_roles(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    member = make_user(db, "plain-member@test.dev")
    target = make_user(db, "target-member@test.dev")
    for user in (member, target):
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="member"))
    db.flush()
    headers = auth_headers(client, "plain-member@test.dev")

    response = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{target.id}",
        headers=headers,
        json={"role": "admin"},
    )
    assert response.status_code == 403


def test_workspace_owner_can_remove_admins_and_members_but_not_owners(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    admin = make_user(db, "remove-admin@test.dev")
    member = make_user(db, "remove-member@test.dev")
    second_owner = make_user(db, "remove-owner@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=second_owner.id, role="owner"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=second_owner.id, role="admin"))
    db.flush()
    headers = auth_headers(client, "owner@test.dev")

    assert client.delete(f"/api/v1/workspaces/{workspace.id}/members/{admin.id}", headers=headers).status_code == 200
    assert client.delete(f"/api/v1/workspaces/{workspace.id}/members/{member.id}", headers=headers).status_code == 200
    blocked_owner = client.delete(f"/api/v1/workspaces/{workspace.id}/members/{second_owner.id}", headers=headers)
    assert blocked_owner.status_code == 403
    assert db.scalar(
        select(Notification).where(
            Notification.user_id == member.id,
            Notification.type == "workspace_member_removed",
        )
    )


def test_workspace_admin_can_remove_members_but_not_other_admins_or_owners_or_self(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    admin = make_user(db, "remove-role-admin@test.dev")
    other_admin = make_user(db, "remove-other-admin@test.dev")
    member = make_user(db, "remove-role-member@test.dev")
    for user in (admin, other_admin, member):
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=other_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, "remove-role-admin@test.dev")

    assert client.delete(f"/api/v1/workspaces/{workspace.id}/members/{member.id}", headers=headers).status_code == 200
    removed_admin = client.delete(f"/api/v1/workspaces/{workspace.id}/members/{other_admin.id}", headers=headers)
    assert removed_admin.status_code == 403, removed_admin.text
    blocked_self = client.delete(f"/api/v1/workspaces/{workspace.id}/members/{admin.id}", headers=headers)
    assert blocked_self.status_code == 403
    blocked_owner = client.delete(f"/api/v1/workspaces/{workspace.id}/members/{owner.id}", headers=headers)
    assert blocked_owner.status_code == 403


def test_workspace_member_cannot_remove_members(client, db, org, owner):
    workspace, _project, _task = _build_workspace(db, org, owner)
    member = make_user(db, "remove-plain-member@test.dev")
    target = make_user(db, "remove-target-member@test.dev")
    for user in (member, target):
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="member"))
    db.flush()
    headers = auth_headers(client, "remove-plain-member@test.dev")

    response = client.delete(f"/api/v1/workspaces/{workspace.id}/members/{target.id}", headers=headers)
    assert response.status_code == 403


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
    assert body["ref"] == format_task_ref(project.id, body["number"])
    assert body["priority"] == "high"

    updated = client.patch(
        f"/api/v1/tasks/{body['id']}", headers=headers, json={"title": "Renamed"}
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Renamed"

    deleted = client.delete(f"/api/v1/tasks/{body['id']}", headers=headers)
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/tasks/{body['id']}", headers=headers).status_code == 404
