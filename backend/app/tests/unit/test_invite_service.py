"""Phase 2 unit tests — invite_service validation rules."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.models.organization import OrganizationMember
from app.services import email_service, invite_service
from app.tests.conftest import make_user


@pytest.mark.unit
@patch("app.services.invite_service.email_service")
def test_create_invite_rejects_invalid_role_for_scope(_mock, db, org, owner):
    with pytest.raises(HTTPException) as exc:
        invite_service.create_invite(
            db,
            inviter=owner,
            email="badrole@test.dev",
            scope="workspace",
            role="owner",
            organization_id=org.id,
        )
    assert exc.value.status_code == 422


@pytest.mark.unit
@patch("app.services.invite_service.email_service")
def test_create_invite_rejects_existing_org_member(_mock, db, org, owner):
    member = make_user(db, "existing-org@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()

    with pytest.raises(HTTPException) as exc:
        invite_service.create_invite(
            db,
            inviter=owner,
            email=member.email,
            scope="organization",
            role="member",
            organization_id=org.id,
        )
    assert exc.value.status_code == 409


@pytest.mark.unit
@patch("app.services.invite_service.email_service")
def test_create_invite_stores_token_hash_not_plaintext(_mock, db, org, owner):
    invite = invite_service.create_invite(
        db,
        inviter=owner,
        email="newinvite@test.dev",
        scope="organization",
        role="member",
        organization_id=org.id,
    )
    assert invite.token_hash
    assert len(invite.token_hash) == 64
    assert invite.status == "pending"
    assert invite.expires_at > datetime.now(timezone.utc)


@pytest.mark.unit
@patch("app.services.invite_service.email_service")
def test_create_invite_normalizes_email(_mock, db, org, owner):
    invite = invite_service.create_invite(
        db,
        inviter=owner,
        email="  MixedCase@Test.dev ",
        scope="organization",
        role="member",
        organization_id=org.id,
    )
    assert invite.email == "mixedcase@test.dev"


@pytest.mark.unit
@patch("app.services.invite_service.email_service")
def test_create_invite_new_user_always_uses_unified_invite_email(_mock, db, org, owner):
    from app.models.project import Project, Space
    from app.models.workspace import Workspace, WorkspaceMember

    ws = Workspace(organization_id=org.id, name="Member WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=ws.id, name="Design", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(workspace_id=ws.id, space_id=space.id, name="Mobile", created_by=owner.id)
    db.add(project)
    db.flush()

    for kwargs in (
        {"scope": "organization", "role": "member", "organization_id": org.id},
        {"scope": "organization", "role": "admin", "organization_id": org.id},
        {"scope": "workspace", "role": "member", "organization_id": org.id, "workspace_id": ws.id},
        {"scope": "workspace", "role": "admin", "organization_id": org.id, "workspace_id": ws.id},
        {"scope": "space", "role": "admin", "organization_id": org.id, "workspace_id": ws.id, "space_id": space.id},
        {"scope": "space", "role": "member", "organization_id": org.id, "workspace_id": ws.id, "space_id": space.id},
        {"scope": "project", "role": "admin", "organization_id": org.id, "workspace_id": ws.id, "project_id": project.id},
        {"scope": "project", "role": "member", "organization_id": org.id, "workspace_id": ws.id, "project_id": project.id},
        {"scope": "project", "role": "viewer", "organization_id": org.id, "workspace_id": ws.id, "project_id": project.id},
    ):
        _mock.reset_mock()
        invite_service.create_invite(
            db,
            inviter=owner,
            email=f"user-{kwargs['scope']}-{kwargs['role']}@test.dev",
            **kwargs,
        )
        _mock.send_new_user_invite_email.assert_called_once()
        _mock.send_existing_user_invite_email.assert_not_called()


@pytest.mark.unit
@patch("app.services.invite_service.email_service")
def test_superadmin_invite_uses_platform_team_label(_mock, db, org, superadmin):
    invite_service.create_invite(
        db,
        inviter=superadmin,
        email="owner-new@test.dev",
        scope="organization",
        role="owner",
        organization_id=org.id,
    )
    assert _mock.send_new_user_invite_email.called
    inviter_name = _mock.send_new_user_invite_email.call_args[0][2]
    assert inviter_name.startswith("The ")
    assert "team" in inviter_name.lower()
    assert inviter_name != email_service.BRAND


@pytest.mark.unit
@patch("app.services.invite_service.email_service")
def test_inviter_helpers(_mock, db, org, owner):
    from app.models.user import User
    from app.services.invite_service import _display_name, _inviter_label

    plain = User(email="plain@test.dev", is_platform_superadmin=False)
    assert _display_name(plain) == "plain@test.dev"
    assert _inviter_label(plain) == "plain@test.dev"


@pytest.mark.unit
@patch("app.services.invite_service.email_service")
@patch("app.services.invite_service.notify")
def test_create_invite_existing_user_sends_accept_email(_mock_notify, _mock_email, db, org, owner):
    from app.models.workspace import Workspace, WorkspaceMember

    ws = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    existing = make_user(db, "existing@test.dev")

    invite = invite_service.create_invite(
        db,
        inviter=owner,
        email=existing.email,
        scope="workspace",
        role="member",
        organization_id=org.id,
        workspace_id=ws.id,
    )
    assert invite.existing_user_id == existing.id
    _mock_email.send_existing_user_invite_email.assert_called_once()
    _mock_email.send_new_user_invite_email.assert_not_called()
    _mock_notify.assert_called_once()
