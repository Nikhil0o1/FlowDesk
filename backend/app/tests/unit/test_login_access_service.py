"""Phase 2 unit tests — login access resolution."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.invite import Invite
from app.models.organization import OrganizationMember
from app.models.workspace import Workspace, WorkspaceMember
from app.services.login_access_service import (
    LoginAccessDenied,
    assert_can_login,
    resolve_login_context,
)
from app.tests.conftest import make_user


@pytest.mark.unit
def test_superadmin_context(db, superadmin):
    ctx = resolve_login_context(db, superadmin)
    assert ctx.kind == "platform_superadmin"
    assert ctx.redirect_to == "/admin/platform"


@pytest.mark.unit
def test_org_owner_context(db, org, owner):
    ctx = resolve_login_context(db, owner)
    assert ctx.kind == "org_owner"
    assert ctx.organization_id == str(org.id)


@pytest.mark.unit
def test_orphan_user_returns_none(db):
    orphan = make_user(db, "orphan-unit@test.dev")
    assert resolve_login_context(db, orphan) is None
    with pytest.raises(LoginAccessDenied):
        assert_can_login(db, orphan)


@pytest.mark.unit
def test_disabled_org_raises(db, org, owner):
    org.is_disabled = True
    db.flush()
    with pytest.raises(LoginAccessDenied) as exc:
        assert_can_login(db, owner)
    assert "disabled" in exc.value.detail.lower()


@pytest.mark.unit
def test_pending_invite_context(db, org, owner):
    pending = make_user(db, "pending-unit@test.dev")
    db.add(
        Invite(
            email=pending.email,
            token_hash="abc",
            scope="workspace",
            role="member",
            organization_id=org.id,
            invited_by=owner.id,
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(days=2),
        )
    )
    db.flush()
    ctx = resolve_login_context(db, pending)
    assert ctx.kind == "pending_invite"


@pytest.mark.unit
def test_workspace_admin_context(db, org, owner):
    ws_admin = make_user(db, "wsadmin-unit@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    workspace = Workspace(organization_id=org.id, name="Admin WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    ctx = resolve_login_context(db, ws_admin)
    assert ctx.kind == "workspace_admin"
    assert ctx.workspace_id == str(workspace.id)
