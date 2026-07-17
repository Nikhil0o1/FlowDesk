"""Coverage — invite accept, activate, preview, org-scoped paths, and email validation."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.email_validation import INVITE_EMAIL_ERROR, normalize_invite_email
from app.core.security import generate_token, hash_token
from app.schemas.project import ProjectInviteCreate
from app.schemas.workspace import WorkspaceInviteCreate
from app.models.invite import Invite
from app.models.organization import OrganizationMember
from app.services import invite_service
from app.tests.conftest import make_user


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_activate_invite_org_scope(_mock, db, org, owner):
    raw = generate_token()
    invite = Invite(
        email="brand-new@test.dev",
        token_hash=hash_token(raw),
        invited_by=owner.id,
        scope="organization",
        role="owner",
        organization_id=org.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        status="pending",
    )
    db.add(invite)
    db.commit()

    user = invite_service.activate_invite(db, raw, "Brand New")
    member = db.query(OrganizationMember).filter_by(user_id=user.id, organization_id=org.id).one()
    assert member.role == "owner"
    assert invite.status == "accepted"


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_accept_invite_by_id_for_existing_user(_mock, db, org, owner):
    from app.models.workspace import Workspace, WorkspaceMember

    ws = Workspace(organization_id=org.id, name="Invite WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    existing = make_user(db, "accept-by-id@test.dev")
    invite = Invite(
        email=existing.email,
        token_hash=hash_token(generate_token()),
        invited_by=owner.id,
        scope="workspace",
        role="member",
        organization_id=org.id,
        workspace_id=ws.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=3),
        status="pending",
        existing_user_id=existing.id,
    )
    db.add(invite)
    db.commit()

    accepted = invite_service.accept_invite_by_id(db, invite.id, existing)
    assert accepted.status == "accepted"
    preview = invite_service.preview_invite_for_user(db, invite.id, existing)
    assert preview["existing_user"] is True


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_accept_invite_rejects_wrong_email(_mock, db, org, owner):
    raw = generate_token()
    invite = Invite(
        email="target@test.dev",
        token_hash=hash_token(raw),
        invited_by=owner.id,
        scope="organization",
        role="member",
        organization_id=org.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=2),
        status="pending",
        existing_user_id=owner.id,
    )
    db.add(invite)
    db.commit()

    other = make_user(db, "other@test.dev")
    with pytest.raises(HTTPException) as exc:
        invite_service.accept_invite(db, raw, other)
    assert exc.value.status_code == 403


@pytest.mark.coverage
def test_get_valid_invite_marks_expired(db, org, owner):
    raw = generate_token()
    invite = Invite(
        email="expired@test.dev",
        token_hash=hash_token(raw),
        invited_by=owner.id,
        scope="organization",
        role="member",
        organization_id=org.id,
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        status="pending",
    )
    db.add(invite)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        invite_service.get_valid_invite(db, raw)
    assert exc.value.status_code == 400
    db.refresh(invite)
    assert invite.status == "expired"


@pytest.mark.coverage
def test_normalize_invite_email_accepts_canonical_provider_domains():
    assert normalize_invite_email("User@Gmail.com") == "user@gmail.com"
    assert normalize_invite_email("user@outlook.com") == "user@outlook.com"
    assert normalize_invite_email("user@googlemail.com") == "user@googlemail.com"
    assert normalize_invite_email("user@live.co.uk") == "user@live.co.uk"
    assert normalize_invite_email("user@msn.com") == "user@msn.com"


@pytest.mark.coverage
def test_normalize_invite_email_accepts_other_regional_domains():
    assert normalize_invite_email("user@company.co.in") == "user@company.co.in"
    assert normalize_invite_email("user@outlook.de") == "user@outlook.de"
    assert normalize_invite_email("user@hotmail.fr") == "user@hotmail.fr"


@pytest.mark.coverage
@pytest.mark.parametrize(
    "email",
    [
        "user@gmail.in",
        "user@gmail.co.uk",
        "ganesh@gmailkkdsfm.com",
        "user@outlookfake.com",
        "user@outlookjhvkjv.in",
        "",
        "notanemail",
        "bad@",
        "@domain.com",
        "user@domain",
        "user..name@domain.com",
    ],
)
def test_normalize_invite_email_rejects_invalid_addresses(email: str):
    with pytest.raises(ValueError, match=INVITE_EMAIL_ERROR):
        normalize_invite_email(email)


@pytest.mark.coverage
def test_invite_schemas_validate_email():
    invite = WorkspaceInviteCreate(email="member@test.dev", role="member")
    assert invite.email == "member@test.dev"
    with pytest.raises(ValidationError):
        WorkspaceInviteCreate(email="not-an-email", role="member")
    with pytest.raises(ValidationError):
        ProjectInviteCreate(email="bad@", role="member")


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_create_invite_rejects_missing_org(_mock, db, owner):
    import uuid

    with pytest.raises(HTTPException) as exc:
        invite_service.create_invite(
            db,
            inviter=owner,
            email="missing-org@test.dev",
            scope="organization",
            role="member",
            organization_id=uuid.uuid4(),
        )
    assert exc.value.status_code == 404


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_create_invite_rejects_existing_target_members(_mock, db, org, owner):
    from app.models.project import Project, ProjectMember, Space, SpaceMember
    from app.models.workspace import Workspace, WorkspaceMember

    ws = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=ws.id, name="Design", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(workspace_id=ws.id, space_id=space.id, name="Mobile", created_by=owner.id)
    db.add(project)
    db.flush()

    ws_member = make_user(db, "ws-member@test.dev")
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=ws_member.id, role="member"))
    db.flush()
    with pytest.raises(HTTPException) as exc:
        invite_service.create_invite(
            db,
            inviter=owner,
            email=ws_member.email,
            scope="workspace",
            role="member",
            organization_id=org.id,
            workspace_id=ws.id,
        )
    assert exc.value.status_code == 409

    space_member = make_user(db, "space-member@test.dev")
    db.add(SpaceMember(space_id=space.id, user_id=space_member.id, role="member"))
    db.flush()
    with pytest.raises(HTTPException) as exc2:
        invite_service.create_invite(
            db,
            inviter=owner,
            email=space_member.email,
            scope="space",
            role="member",
            organization_id=org.id,
            workspace_id=ws.id,
            space_id=space.id,
        )
    assert exc2.value.status_code == 409

    project_member = make_user(db, "project-member@test.dev")
    db.add(ProjectMember(project_id=project.id, user_id=project_member.id, role="member"))
    db.flush()
    with pytest.raises(HTTPException) as exc3:
        invite_service.create_invite(
            db,
            inviter=owner,
            email=project_member.email,
            scope="project",
            role="member",
            organization_id=org.id,
            workspace_id=ws.id,
            project_id=project.id,
        )
    assert exc3.value.status_code == 409


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_create_invite_rejects_user_in_other_org(_mock, db, org, owner):
    from app.models.organization import Organization
    from app.models.workspace import Workspace, WorkspaceMember

    other_org = Organization(name="Other Org")
    db.add(other_org)
    db.flush()
    outsider = make_user(db, "outsider@test.dev")
    db.add(OrganizationMember(organization_id=other_org.id, user_id=outsider.id, role="member"))
    ws = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))

    with pytest.raises(HTTPException) as exc:
        invite_service.create_invite(
            db,
            inviter=owner,
            email=outsider.email,
            scope="workspace",
            role="member",
            organization_id=org.id,
            workspace_id=ws.id,
        )
    assert exc.value.status_code == 409


@pytest.mark.coverage
def test_preview_invite_uses_space_target_name(db, org, owner):
    from app.models.project import Space
    from app.models.workspace import Workspace, WorkspaceMember

    raw = generate_token()
    ws = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=ws.id, name="Design Space", created_by=owner.id)
    db.add(space)
    db.flush()
    invite = Invite(
        email="space-preview@test.dev",
        token_hash=hash_token(raw),
        invited_by=owner.id,
        scope="space",
        role="member",
        organization_id=org.id,
        workspace_id=ws.id,
        space_id=space.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=2),
        status="pending",
    )
    db.add(invite)
    db.commit()

    preview = invite_service.preview_invite(db, raw)
    assert preview["target_name"] == "Design Space"


@pytest.mark.coverage
def test_preview_invite_for_user_pending_space_invite(db, org, owner):
    from app.models.project import Space
    from app.models.workspace import Workspace, WorkspaceMember

    existing = make_user(db, "space-user@test.dev")
    ws = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=ws.id, name="Ops Space", created_by=owner.id)
    db.add(space)
    db.flush()
    invite = Invite(
        email=existing.email,
        token_hash=hash_token(generate_token()),
        invited_by=owner.id,
        scope="space",
        role="admin",
        organization_id=org.id,
        workspace_id=ws.id,
        space_id=space.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=2),
        status="pending",
        existing_user_id=existing.id,
    )
    db.add(invite)
    db.commit()

    preview = invite_service.preview_invite_for_user(db, invite.id, existing)
    assert preview["target_name"] == "Ops Space"
    assert preview["role"] == "admin"


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_activate_invite_space_scope(_mock, db, org, owner):
    from app.models.project import Space, SpaceMember
    from app.models.workspace import Workspace, WorkspaceMember

    raw = generate_token()
    ws = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=ws.id, name="Growth", created_by=owner.id)
    db.add(space)
    db.flush()
    invite = Invite(
        email="space-activate@test.dev",
        token_hash=hash_token(raw),
        invited_by=owner.id,
        scope="space",
        role="member",
        organization_id=org.id,
        workspace_id=ws.id,
        space_id=space.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=2),
        status="pending",
    )
    db.add(invite)
    db.commit()

    user = invite_service.activate_invite(db, raw, "Space User")
    from sqlalchemy import select

    member = db.scalar(
        select(SpaceMember).where(
            SpaceMember.space_id == space.id,
            SpaceMember.user_id == user.id,
        )
    )
    assert member is not None
    assert member.role == "member"


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_activate_invite_grants_all_pending_invites_for_email(_mock, db, org, owner):
    """A single activation link unlocks every pending invite for that email."""
    from sqlalchemy import select

    from app.models.project import Project, ProjectMember, Space
    from app.models.workspace import Workspace, WorkspaceMember

    ws = Workspace(organization_id=org.id, name="Multi WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=ws.id, name="Delivery", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(space_id=space.id, workspace_id=ws.id, name="Phoenix", created_by=owner.id)
    db.add(project)
    db.flush()

    email = "multi-activate@test.dev"
    expires = datetime.now(timezone.utc) + timedelta(days=2)
    primary_raw = generate_token()
    invites = [
        Invite(
            email=email, token_hash=hash_token(primary_raw), invited_by=owner.id,
            scope="workspace", role="member", organization_id=org.id, workspace_id=ws.id,
            expires_at=expires, status="pending",
        ),
        Invite(
            email=email, token_hash=hash_token(generate_token()), invited_by=owner.id,
            scope="project", role="member", organization_id=org.id, workspace_id=ws.id,
            project_id=project.id, expires_at=expires, status="pending",
        ),
    ]
    db.add_all(invites)
    db.commit()

    user = invite_service.activate_invite(db, primary_raw, "Multi User")

    # Both the workspace and the project membership are granted from one link.
    assert db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws.id, WorkspaceMember.user_id == user.id
        )
    ) is not None
    assert db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == user.id
        )
    ) is not None
    # Every pending invite for this email is consumed.
    remaining = db.scalars(
        select(Invite).where(Invite.email == email, Invite.status == "pending")
    ).all()
    assert remaining == []
