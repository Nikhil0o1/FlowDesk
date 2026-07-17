"""Login access: invitation-only sign-in and role-based landing context."""
import pytest

from app.models.organization import Organization, OrganizationMember
from app.models.workspace import Workspace, WorkspaceMember
from app.services.login_access_service import (
    LOGIN_PERMISSION_MESSAGE,
    LoginAccessDenied,
    assert_can_login,
    resolve_login_context,
)
from app.tests.conftest import make_user, seed_login_otp


def test_superadmin_can_login_without_org_membership(db):
    user = make_user(db, "super@test.dev", superadmin=True)
    ctx = assert_can_login(db, user)
    assert ctx.kind == "platform_superadmin"
    assert ctx.redirect_to == "/admin/platform"


def test_user_without_membership_cannot_login(db):
    user = make_user(db, "orphan@test.dev")
    with pytest.raises(LoginAccessDenied) as exc:
        assert_can_login(db, user)
    assert LOGIN_PERMISSION_MESSAGE in exc.value.detail


def test_org_owner_lands_on_workspaces(db, org, owner):
    ctx = assert_can_login(db, owner)
    assert ctx.kind == "org_owner"
    assert ctx.role == "owner"
    assert ctx.redirect_to == "/app/workspaces"
    assert ctx.organization_id == str(org.id)


def test_workspace_admin_lands_on_workspace(db, org, owner):
    ws = Workspace(organization_id=org.id, name="Engineering", created_by=owner.id)
    db.add(ws)
    db.flush()
    admin = make_user(db, "admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=admin.id, role="admin"))
    db.flush()

    ctx = assert_can_login(db, admin)
    assert ctx.kind == "workspace_admin"
    assert ctx.redirect_to == f"/app/workspaces/{ws.id}"
    assert ctx.workspace_id == str(ws.id)


def test_org_member_lands_on_dashboard(db, org, owner):
    member = make_user(db, "member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()

    ctx = assert_can_login(db, member)
    assert ctx.kind == "member"
    assert ctx.redirect_to == "/app/dashboard"
    assert ctx.organization_id == str(org.id)


def test_disabled_org_blocks_login(db, org, owner):
    org.is_disabled = True
    db.flush()
    with pytest.raises(LoginAccessDenied) as exc:
        assert_can_login(db, owner)
    assert "disabled" in exc.value.detail.lower()


def test_login_returns_login_context(client, owner, db):
    seed_login_otp(db, "owner@test.dev", "424242")
    response = client.post(
        "/api/v1/auth/otp/verify", json={"email": "owner@test.dev", "code": "424242"}
    )
    assert response.status_code == 200
    ctx = response.json()["login_context"]
    assert ctx["kind"] == "org_owner"
    assert ctx["redirect_to"] == "/app/workspaces"


def test_orphan_user_login_rejected(client, db):
    make_user(db, "orphan@test.dev")
    seed_login_otp(db, "orphan@test.dev", "424242")
    response = client.post(
        "/api/v1/auth/otp/verify", json={"email": "orphan@test.dev", "code": "424242"}
    )
    assert response.status_code == 403
    assert "permission" in response.json()["detail"].lower()


def test_user_with_pending_invite_can_login(db, org, owner):
    from unittest.mock import patch

    from app.models.workspace import Workspace
    from app.services import invite_service

    ws = Workspace(organization_id=org.id, name="New Team", created_by=owner.id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    existing = make_user(db, "pending@test.dev")

    with patch("app.services.invite_service.email_service"):
        invite_service.create_invite(
            db,
            inviter=owner,
            email="pending@test.dev",
            scope="workspace",
            role="member",
            organization_id=org.id,
            workspace_id=ws.id,
        )

    ctx = assert_can_login(db, existing)
    assert ctx.kind == "pending_invite"
    assert ctx.redirect_to == "/app/dashboard"


def test_me_returns_login_context(client, owner, db):
    seed_login_otp(db, "owner@test.dev", "424242")
    login = client.post(
        "/api/v1/auth/otp/verify", json={"email": "owner@test.dev", "code": "424242"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["email"] == "owner@test.dev"
    assert data["login_context"]["kind"] == "org_owner"
