"""Private task ACL, share members, and public link access (VAPT #13)."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.organization import OrganizationMember
from app.models.project import ProjectMember
from app.models.task import Task, TaskAssignee, TaskShareMember
from app.services.permission_service import PermissionError403, PermissionService
from app.services.public_access_service import resolve_public_task
from app.tests.conftest import auth_headers, make_user
from app.core.task_ref import format_task_ref
from app.tests.helpers import add_project_member, add_task, build_project_stack

pytestmark = pytest.mark.integration


def _private_task(db, project, owner, *, title: str = "Private") -> Task:
    task = add_task(db, project, owner, title=title, number=99)
    task.is_private = True
    db.flush()
    return task


def test_private_task_hidden_from_project_member(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    outsider = add_project_member(db, org, workspace, project, "outsider@test.dev")
    task = _private_task(db, project, owner)

    headers = auth_headers(client, outsider.email)
    listed = client.get(f"/api/v1/projects/{project.id}/tasks", headers=headers)
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert all(t["id"] != str(task.id) for t in items)

    detail = client.get(f"/api/v1/tasks/{task.id}", headers=headers)
    assert detail.status_code == 404


def test_share_member_viewer_can_read_not_edit(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    viewer = add_project_member(db, org, workspace, project, "viewer@test.dev")
    task = _private_task(db, project, owner)
    db.add(TaskShareMember(task_id=task.id, user_id=viewer.id, role="viewer", created_by=owner.id))
    db.flush()

    headers = auth_headers(client, viewer.email)
    assert client.get(f"/api/v1/tasks/{task.id}", headers=headers).status_code == 200

    patch = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"title": "Hacked"},
    )
    assert patch.status_code == 403


def test_share_member_editor_can_edit(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    editor = add_project_member(db, org, workspace, project, "editor@test.dev")
    task = _private_task(db, project, owner)
    db.add(TaskShareMember(task_id=task.id, user_id=editor.id, role="editor", created_by=owner.id))
    db.flush()

    headers = auth_headers(client, editor.email)
    patch = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"title": "Updated by editor"},
    )
    assert patch.status_code == 200
    assert patch.json()["title"] == "Updated by editor"


def test_assignee_can_view_private_task(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    assignee = add_project_member(db, org, workspace, project, "assignee@test.dev")
    task = _private_task(db, project, owner)
    db.add(TaskAssignee(task_id=task.id, user_id=assignee.id))
    db.flush()

    headers = auth_headers(client, assignee.email)
    assert client.get(f"/api/v1/tasks/{task.id}", headers=headers).status_code == 200


def test_creator_can_manage_share_settings(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = _private_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    share = client.patch(
        f"/api/v1/tasks/{task.id}/share",
        headers=headers,
        json={"public_enabled": True},
    )
    assert share.status_code == 200
    assert share.json()["public_enabled"] is True
    assert share.json()["public_url"]


def test_non_admin_cannot_manage_share(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    editor = add_project_member(db, org, workspace, project, "notadmin@test.dev")
    task = _private_task(db, project, owner)
    db.add(TaskShareMember(task_id=task.id, user_id=editor.id, role="editor", created_by=owner.id))
    db.flush()

    headers = auth_headers(client, editor.email)
    share = client.patch(
        f"/api/v1/tasks/{task.id}/share",
        headers=headers,
        json={"public_enabled": True},
    )
    assert share.status_code == 403


def test_public_task_link_anonymous_read(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Public shared", number=50)
    task.public_enabled = True
    task.public_token = "test-public-token-abc123"
    db.flush()

    response = client.get(f"/api/v1/public/tasks/{task.public_token}")
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Public shared"
    assert data["ref"] == format_task_ref(project.id, 50)
    assert "email" not in str(data).lower()


def test_public_task_expired_link_returns_404(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, number=51)
    task.public_enabled = True
    task.public_token = "expired-token"
    task.public_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db.flush()

    assert client.get(f"/api/v1/public/tasks/expired-token").status_code == 404


def test_public_task_disabled_org_returns_404(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, number=52)
    task.public_enabled = True
    task.public_token = "disabled-org-token"
    org.is_disabled = True
    db.flush()

    assert client.get("/api/v1/public/tasks/disabled-org-token").status_code == 404


def test_permission_service_visible_task_filter_excludes_private(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    outsider = add_project_member(db, org, workspace, project, "filter@test.dev")
    _private_task(db, project, owner, title="Hidden")

    perms = PermissionService(db, outsider)
    from sqlalchemy import select

    visible = db.scalars(
        select(Task).where(Task.project_id == project.id, perms.visible_task_filter())
    ).all()
    assert all(not t.is_private for t in visible)


def test_resolve_public_task_rejects_disabled_share(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, number=53)
    task.public_token = "off-token"
    task.public_enabled = False
    db.flush()

    with pytest.raises(Exception) as exc:
        resolve_public_task(db, "off-token")
    assert exc.value.status_code == 404


def test_require_task_edit_private_viewer_raises(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    viewer = add_project_member(db, org, workspace, project, "permviewer@test.dev")
    task = _private_task(db, project, owner)
    db.add(TaskShareMember(task_id=task.id, user_id=viewer.id, role="viewer", created_by=owner.id))
    db.flush()

    perms = PermissionService(db, viewer)
    with pytest.raises(PermissionError403):
        perms.require_task_edit(task)
