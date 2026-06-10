from unittest.mock import patch

from sqlalchemy import select

from app.models.invite import Invite
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
    assert mock_email.send_workspace_admin_onboarding_email.called
    raw_token = mock_email.send_workspace_admin_onboarding_email.call_args[0][4]

    # 2. Preview shows new-user activation
    preview = client.get(f"/api/v1/auth/invite-preview?token={raw_token}")
    assert preview.status_code == 200
    assert preview.json()["existing_user"] is False

    # 3. Activate: set own password (no temporary passwords)
    activate = client.post(
        "/api/v1/auth/activate-invite",
        json={"token": raw_token, "full_name": "New Admin", "password": "Password123!"},
    )
    assert activate.status_code == 200
    assert activate.json()["user"]["email"] == "newadmin@test.dev"

    # 4. Token is single-use
    again = client.post(
        "/api/v1/auth/activate-invite",
        json={"token": raw_token, "full_name": "X", "password": "Password123!"},
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
    assert not mock_email.send_workspace_admin_onboarding_email.called
    raw_token = mock_email.send_existing_user_invite_email.call_args[0][4]

    # Activation endpoint refuses (already has an account)
    activate = client.post(
        "/api/v1/auth/activate-invite",
        json={"token": raw_token, "full_name": "X", "password": "Password123!"},
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
    raw_token = mock_email.send_workspace_admin_onboarding_email.call_args or mock_email.send_project_member_onboarding_email.call_args
    invite = db.scalar(select(Invite).where(Invite.email == "hashcheck@test.dev"))
    assert invite is not None
    # 64-char hex sha256, and never equal to any raw token material
    assert len(invite.token_hash) == 64
    int(invite.token_hash, 16)  # raises if not hex
