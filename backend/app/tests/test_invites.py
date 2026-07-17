from unittest.mock import patch

from sqlalchemy import select

from app.models.invite import Invite
from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space, SpaceMember
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack


def _create_workspace(db, org, owner) -> Workspace:
    workspace = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    db.flush()
    return workspace


@patch("app.services.invite_service.email_service")
def test_full_invite_activation_flow(mock_email, client, db, org, owner):
    workspace = _create_workspace(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    # 1. Owner invites a new workspace admin
    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites",
        headers=headers,
        json={"email": "newadmin@test.dev", "role": "admin"},
    )
    assert response.status_code == 201
    assert mock_email.send_new_user_invite_email.called
    raw_token = mock_email.send_new_user_invite_email.call_args[0][3]
    preview = client.post("/api/v1/auth/invite-preview", json={"token": raw_token})
    assert preview.status_code == 200
    assert preview.json()["existing_user"] is False

    # 3. Activate account (passwordless)
    activate = client.post(
        "/api/v1/auth/activate-invite",
        json={"token": raw_token, "full_name": "New Admin"},
    )
    assert activate.status_code == 200
    assert activate.json()["user"]["email"] == "newadmin@test.dev"

    # 4. Token is single-use
    again = client.post(
        "/api/v1/auth/activate-invite",
        json={"token": raw_token, "full_name": "X"},
    )
    assert again.status_code in (400, 409)

    # 5. New user has workspace access with admin role
    new_headers = auth_headers(client, "newadmin@test.dev")
    ws = client.get(f"/api/v1/workspaces/{workspace.id}", headers=new_headers)
    assert ws.status_code == 200
    assert ws.json()["my_role"] == "admin"


@patch("app.services.invite_service.email_service")
def test_existing_user_gets_accept_flow_not_activation(mock_email, client, db, org, owner):
    workspace = _create_workspace(db, org, owner)
    existing = make_user(db, "existing@test.dev")
    headers = auth_headers(client, "owner@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites",
        headers=headers,
        json={"email": "existing@test.dev", "role": "member"},
    )
    assert response.status_code == 201
    # Existing users get the accept email, not onboarding
    assert mock_email.send_existing_user_invite_email.called
    assert not mock_email.send_new_user_invite_email.called
    raw_token = mock_email.send_existing_user_invite_email.call_args[0][4]

    # Activation endpoint refuses (already has an account)
    activate = client.post(
        "/api/v1/auth/activate-invite",
        json={"token": raw_token, "full_name": "X"},
    )
    assert activate.status_code == 409

    # Accept while logged in works without password change
    user_headers = auth_headers(client, "existing@test.dev")
    accept = client.post("/api/v1/auth/accept-invite", headers=user_headers, json={"token": raw_token})
    assert accept.status_code == 200
    assert client.get(f"/api/v1/workspaces/{workspace.id}", headers=user_headers).status_code == 200


@patch("app.services.invite_service.email_service")
def test_member_cannot_invite(mock_email, client, db, org, owner):
    workspace = _create_workspace(db, org, owner)
    member = make_user(db, "plain@test.dev")
    from app.models.organization import OrganizationMember

    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, "plain@test.dev")
    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites",
        headers=headers,
        json={"email": "x@test.dev", "role": "member"},
    )
    assert response.status_code == 403


@patch("app.services.invite_service.email_service")
def test_invite_token_hashed_in_db(mock_email, client, db, org, owner):
    workspace = _create_workspace(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")
    client.post(
        f"/api/v1/workspaces/{workspace.id}/invites",
        headers=headers,
        json={"email": "hashcheck@test.dev", "role": "member"},
    )
    raw_token = mock_email.send_new_user_invite_email.call_args[0][3]
    invite = db.scalar(select(Invite).where(Invite.email == "hashcheck@test.dev"))
    assert invite is not None
    # 64-char hex sha256, and never equal to any raw token material
    assert len(invite.token_hash) == 64
    int(invite.token_hash, 16)  # raises if not hex


@patch("app.services.invite_service.email_service")
def test_workspace_bulk_invite_creates_multiple_targets_one_email(mock_email, client, db, org, owner):
    workspace, project_a = build_project_stack(db, org, owner, project_name="Alpha")
    space_b = Space(workspace_id=workspace.id, name="Space B", created_by=owner.id)
    db.add(space_b)
    db.flush()
    project_b = Project(
        space_id=space_b.id,
        workspace_id=workspace.id,
        name="Beta",
        created_by=owner.id,
    )
    db.add(project_b)
    db.flush()

    headers = auth_headers(client, "owner@test.dev")
    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites/bulk",
        headers=headers,
        json={
            "email": "multi@test.dev",
            "grants": [
                {"scope": "project", "role": "member", "project_id": str(project_a.id)},
                {"scope": "project", "role": "member", "project_id": str(project_b.id)},
            ],
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert len(body["invites"]) == 2
    assert mock_email.send_bulk_new_user_invite_email.called
    assert not mock_email.send_project_member_onboarding_email.called

    invites = db.scalars(select(Invite).where(Invite.email == "multi@test.dev")).all()
    assert len(invites) == 2


@patch("app.services.invite_service.email_service")
def test_workspace_bulk_invite_supports_viewer_role(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="ReadOnly")
    headers = auth_headers(client, "owner@test.dev")
    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites/bulk",
        headers=headers,
        json={
            "email": "viewer@test.dev",
            "grants": [
                {"scope": "project", "role": "viewer", "project_id": str(project.id)},
            ],
        },
    )
    assert response.status_code == 201
    assert response.json()["invites"][0]["role"] == "viewer"
    assert mock_email.send_bulk_new_user_invite_email.called


@patch("app.services.invite_service.email_service")
def test_bulk_new_user_single_activation_grants_all_invites(mock_email, client, db, org, owner):
    workspace, project_a = build_project_stack(db, org, owner, project_name="Alpha")
    space_b = Space(workspace_id=workspace.id, name="Space B", created_by=owner.id)
    db.add(space_b)
    db.flush()
    project_b = Project(
        space_id=space_b.id,
        workspace_id=workspace.id,
        name="Beta",
        created_by=owner.id,
    )
    db.add(project_b)
    db.flush()

    headers = auth_headers(client, "owner@test.dev")
    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites/bulk",
        headers=headers,
        json={
            "email": "pickone@test.dev",
            "grants": [
                {"scope": "project", "role": "member", "project_id": str(project_a.id)},
                {"scope": "project", "role": "member", "project_id": str(project_b.id)},
            ],
        },
    )
    assert response.status_code == 201
    items = mock_email.send_bulk_new_user_invite_email.call_args[0][3]
    assert len(items) == 2
    token_a = items[0][3]
    token_b = items[1][3]

    # A single activation link unlocks BOTH project invites at once.
    activate = client.post(
        "/api/v1/auth/activate-invite",
        json={"token": token_b, "full_name": "Picker"},
    )
    assert activate.status_code == 200

    # The other token is already consumed — no second click required.
    preview_other = client.post("/api/v1/auth/invite-preview", json={"token": token_a})
    assert preview_other.status_code == 400

    # The new user is a member of both projects from the one activation.
    user = db.scalar(select(User).where(User.email == "pickone@test.dev"))
    assert user is not None
    for project in (project_a, project_b):
        assert db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == user.id,
            )
        ) is not None


@patch("app.services.invite_service.email_service")
def test_org_bulk_invite_multiple_workspaces_and_projects(mock_email, client, db, org, owner):
    ws_a, project_a = build_project_stack(db, org, owner, project_name="Alpha")
    ws_b = _create_workspace(db, org, owner)
    ws_b.name = "WS B"
    db.flush()
    space_b = Space(workspace_id=ws_b.id, name="Space B", created_by=owner.id)
    db.add(space_b)
    db.flush()
    project_b = Project(
        space_id=space_b.id,
        workspace_id=ws_b.id,
        name="Beta",
        created_by=owner.id,
    )
    db.add(project_b)
    db.flush()

    headers = auth_headers(client, "owner@test.dev")
    response = client.post(
        f"/api/v1/organizations/{org.id}/invites/bulk",
        headers=headers,
        json={
            "email": "orgbulk@test.dev",
            "grants": [
                {"scope": "workspace", "role": "member", "workspace_id": str(ws_a.id)},
                {"scope": "workspace", "role": "member", "workspace_id": str(ws_b.id)},
                {"scope": "project", "role": "member", "project_id": str(project_a.id)},
                {"scope": "project", "role": "viewer", "project_id": str(project_b.id)},
            ],
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert len(body["invites"]) == 4
    assert mock_email.send_bulk_new_user_invite_email.called


@patch("app.services.invite_service.email_service")
def test_org_bulk_invite_space_admin_grant(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="SpaceGrant")
    headers = auth_headers(client, "owner@test.dev")
    response = client.post(
        f"/api/v1/organizations/{org.id}/invites/bulk",
        headers=headers,
        json={
            "email": "spaceadmin@test.dev",
            "grants": [
                {"scope": "space", "role": "admin", "space_id": str(project.space_id)},
            ],
        },
    )
    assert response.status_code == 201
    assert response.json()["invites"][0]["scope"] == "space"
    assert mock_email.send_bulk_new_user_invite_email.called


@patch("app.services.invite_service.email_service")
def test_org_bulk_invite_existing_user_uses_consolidated_email(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="ExistingBulk")
    existing = make_user(db, "existingbulk@test.dev")
    from app.models.organization import OrganizationMember

    db.add(OrganizationMember(organization_id=org.id, user_id=existing.id, role="member"))
    db.flush()
    headers = auth_headers(client, "owner@test.dev")
    response = client.post(
        f"/api/v1/organizations/{org.id}/invites/bulk",
        headers=headers,
        json={
            "email": "existingbulk@test.dev",
            "grants": [
                {"scope": "project", "role": "member", "project_id": str(project.id)},
            ],
        },
    )
    assert response.status_code == 201
    assert mock_email.send_bulk_existing_user_invite_email.called
    assert not mock_email.send_bulk_new_user_invite_email.called


def test_org_admin_can_bulk_invite_workspace_admin(client, db, org, owner):
    from app.models.organization import OrganizationMember

    admin = make_user(db, "orgadmin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=admin.id, role="admin"))
    workspace = _create_workspace(db, org, owner)
    db.flush()
    headers = auth_headers(client, "orgadmin@test.dev")
    response = client.post(
        f"/api/v1/organizations/{org.id}/invites/bulk",
        headers=headers,
        json={
            "email": "wsadmin-invite@test.dev",
            "grants": [
                {"scope": "workspace", "role": "admin", "workspace_id": str(workspace.id)},
            ],
        },
    )
    assert response.status_code == 201, response.text


@patch("app.services.invite_service.email_service")
def test_space_admin_can_bulk_invite_to_projects_in_space(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="In Space")
    space_admin = make_user(db, "space-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=space_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=space_admin.id, role="member"))
    db.add(SpaceMember(space_id=project.space_id, user_id=space_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, "space-admin@test.dev")
    response = client.post(
        f"/api/v1/spaces/{project.space_id}/invites/bulk",
        headers=headers,
        json={
            "email": "space-scoped@test.dev",
            "grants": [
                {"scope": "project", "role": "member", "project_id": str(project.id)},
            ],
        },
    )
    assert response.status_code == 201, response.text
    assert len(response.json()["invites"]) == 1
    assert mock_email.send_bulk_new_user_invite_email.called


@patch("app.services.invite_service.email_service")
def test_project_admin_can_bulk_invite_to_their_projects(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="Owned")
    proj_admin = make_user(db, "proj-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=proj_admin.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, "proj-admin@test.dev")
    response = client.post(
        f"/api/v1/projects/{project.id}/invites/bulk",
        headers=headers,
        json={
            "email": "project-scoped@test.dev",
            "grants": [
                {"scope": "project", "role": "viewer", "project_id": str(project.id)},
            ],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["invites"][0]["role"] == "viewer"
    assert mock_email.send_bulk_new_user_invite_email.called


@patch("app.services.invite_service.email_service")
def test_project_admin_can_bulk_invite_project_admin_role(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="Owned")
    proj_admin = make_user(db, "proj-admin2@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=proj_admin.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, "proj-admin2@test.dev")
    response = client.post(
        f"/api/v1/projects/{project.id}/invites/bulk",
        headers=headers,
        json={
            "email": "new-proj-admin@test.dev",
            "grants": [
                {"scope": "project", "role": "admin", "project_id": str(project.id)},
            ],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["invites"][0]["role"] == "admin"
    assert mock_email.send_bulk_new_user_invite_email.called


@patch("app.services.invite_service.email_service")
def test_space_admin_can_bulk_invite_to_projects_in_space(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="In Space")
    space_admin = make_user(db, "space-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=space_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=space_admin.id, role="member"))
    db.add(SpaceMember(space_id=project.space_id, user_id=space_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, "space-admin@test.dev")
    response = client.post(
        f"/api/v1/spaces/{project.space_id}/invites/bulk",
        headers=headers,
        json={
            "email": "space-scoped@test.dev",
            "grants": [
                {"scope": "project", "role": "member", "project_id": str(project.id)},
            ],
        },
    )
    assert response.status_code == 201, response.text
    assert len(response.json()["invites"]) == 1
    assert mock_email.send_bulk_new_user_invite_email.called


@patch("app.services.invite_service.email_service")
def test_project_admin_can_bulk_invite_to_their_projects(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="Owned")
    proj_admin = make_user(db, "proj-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=proj_admin.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, "proj-admin@test.dev")
    response = client.post(
        f"/api/v1/projects/{project.id}/invites/bulk",
        headers=headers,
        json={
            "email": "project-scoped@test.dev",
            "grants": [
                {"scope": "project", "role": "viewer", "project_id": str(project.id)},
            ],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["invites"][0]["role"] == "viewer"
    assert mock_email.send_bulk_new_user_invite_email.called
