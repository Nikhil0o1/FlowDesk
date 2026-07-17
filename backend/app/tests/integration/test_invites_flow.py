"""Phase 3 integration — invite activation and accept flows."""
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.invite import Invite
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user


def _workspace(db, org, owner):
    ws = Workspace(organization_id=org.id, name="Invite WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    db.flush()
    return ws


@pytest.mark.integration
@patch("app.services.invite_service.email_service")
def test_workspace_invite_activation_end_to_end(mock_email, client, db, org, owner):
    workspace = _workspace(db, org, owner)
    headers = auth_headers(client, owner.email)

    invite_resp = client.post(
        f"/api/v1/workspaces/{workspace.id}/invites",
        headers=headers,
        json={"email": "activated@test.dev", "role": "member"},
    )
    assert invite_resp.status_code == 201
    raw_token = mock_email.send_new_user_invite_email.call_args[0][3]

    preview = client.post("/api/v1/auth/invite-preview", json={"token": raw_token})
    assert preview.status_code == 200
    assert preview.json()["existing_user"] is False

    activate = client.post(
        "/api/v1/auth/activate-invite",
        json={"token": raw_token, "full_name": "Activated User"},
    )
    assert activate.status_code == 200
    assert activate.json()["user"]["email"] == "activated@test.dev"

    invite = db.scalar(select(Invite).where(Invite.email == "activated@test.dev"))
    assert invite.status == "accepted"


@pytest.mark.integration
@patch("app.services.invite_service.email_service")
def test_existing_user_accept_invite(mock_email, client, db, org, owner):
    workspace = _workspace(db, org, owner)
    existing = make_user(db, "existing-invite@test.dev")
    headers = auth_headers(client, owner.email)

    client.post(
        f"/api/v1/workspaces/{workspace.id}/invites",
        headers=headers,
        json={"email": existing.email, "role": "member"},
    )
    raw_token = mock_email.send_existing_user_invite_email.call_args[0][4]

    user_headers = auth_headers(client, existing.email)
    accept = client.post(
        "/api/v1/auth/accept-invite",
        headers=user_headers,
        json={"token": raw_token},
    )
    assert accept.status_code == 200

    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == existing.id,
        )
    )
    assert member is not None
