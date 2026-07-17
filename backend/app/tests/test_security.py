"""Security-focused regression tests for backend hardening issues."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.models.organization import OrganizationMember
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user


def _create_workspace(db, org, owner) -> Workspace:
    workspace = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    db.flush()
    return workspace


@patch("app.services.invite_service.email_service")
def test_workspace_admin_cannot_invite_admin(mock_email, client, db, org, owner):
    workspace = _create_workspace(db, org, owner)
    ws_admin = make_user(db, "ws-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()
    headers = auth_headers(client, "ws-admin@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites",
        headers=headers,
        json={"email": "newadmin@test.dev", "role": "admin"},
    )
    assert response.status_code == 403


@patch("app.services.invite_service.email_service")
def test_org_owner_can_invite_workspace_admin(mock_email, client, db, org, owner):
    workspace = _create_workspace(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites",
        headers=headers,
        json={"email": "allowed-admin@test.dev", "role": "admin"},
    )
    assert response.status_code == 201


@patch("app.services.invite_service.email_service")
def test_workspace_admin_cannot_promote_member_to_admin(mock_email, client, db, org, owner):
    workspace = _create_workspace(db, org, owner)
    ws_admin = make_user(db, "ws-admin2@test.dev")
    member = make_user(db, "ws-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, "ws-admin2@test.dev")

    response = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{member.id}",
        headers=headers,
        json={"role": "admin"},
    )
    assert response.status_code == 403


def test_manual_time_entry_rejects_future_range(client, db, org, owner):
    from app.tests.test_permissions import _build_workspace

    _workspace, project, task = _build_workspace(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")
    future = datetime.now(timezone.utc) + timedelta(hours=2)

    response = client.post(
        f"/api/v1/tasks/{task.id}/time-entries",
        headers=headers,
        json={
            "started_at": future.isoformat(),
            "ended_at": (future + timedelta(hours=1)).isoformat(),
        },
    )
    assert response.status_code == 422


def test_github_repo_name_validation_rejects_path_traversal(client, db, org, owner):
    import uuid as uuid_mod

    from app.tests.test_permissions import _build_workspace

    _workspace, project, _task = _build_workspace(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    response = client.post(
        "/api/v1/github/repositories",
        headers=headers,
        json={
            "installation_id": str(uuid_mod.uuid4()),
            "repo_id": 1,
            "repo_full_name": "owner/../evil",
            "project_id": str(project.id),
        },
    )
    assert response.status_code == 422
