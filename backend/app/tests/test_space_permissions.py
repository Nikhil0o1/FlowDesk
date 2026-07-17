"""Tests for space membership, effective_project_role, and the higher-level
admin bypass rules introduced with the SpaceMember feature."""
import pytest
from sqlalchemy import select

from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space, SpaceMember, TaskList
from app.models.task import CustomStatus
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture()
def ws(db, org, owner):
    workspace = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    db.flush()
    return workspace


@pytest.fixture()
def space(db, ws, owner):
    s = Space(workspace_id=ws.id, name="TestSpace", created_by=owner.id)
    db.add(s)
    db.flush()
    return s


@pytest.fixture()
def project(db, ws, space, owner):
    p = Project(
        space_id=space.id, workspace_id=ws.id,
        name="TestProject", created_by=owner.id,
    )
    db.add(p)
    db.flush()
    db.add(TaskList(project_id=p.id, name="Tasks", position=0, created_by=owner.id))
    db.add(CustomStatus(project_id=p.id, name="To Do", color="#aaa", category="todo", position=0))
    db.add(ProjectMember(project_id=p.id, user_id=owner.id, role="admin"))
    db.flush()
    return p


_counter = 0

def _make_org_member(db, org, role="member"):
    global _counter
    _counter += 1
    user = make_user(db, f"u_{role}_{_counter}@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=role))
    db.flush()
    return user


def _add_ws_member(db, ws, user, role="member"):
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=role))
    db.flush()


def _add_space_member(db, space, user, role="member"):
    db.add(SpaceMember(space_id=space.id, user_id=user.id, role=role))
    db.flush()


def _add_project_member(db, project, user, role="member"):
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role=role))
    db.flush()


# ── effective_project_role ────────────────────────────────────────────────────

def test_effective_role_org_admin_returns_admin(client, db, org, ws, space, project):
    """Org admin's effective project role is always 'admin' without any explicit row."""
    admin = _make_org_member(db, org, role="admin")
    _add_ws_member(db, ws, admin, role="member")
    headers = auth_headers(client, admin.email)
    r = client.get(f"/api/v1/projects/{project.id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["my_role"] == "admin"


def test_effective_role_ws_admin_returns_admin(client, db, org, ws, space, project):
    """Workspace admin gets my_role=admin on all projects, no ProjectMember row needed."""
    ws_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, ws_admin, role="admin")
    headers = auth_headers(client, ws_admin.email)
    r = client.get(f"/api/v1/projects/{project.id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["my_role"] == "admin"


def test_effective_role_space_admin_returns_admin(client, db, org, ws, space, project):
    """Space admin gets my_role=admin on projects in their space."""
    sa = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, sa, role="member")
    _add_space_member(db, space, sa, role="admin")
    headers = auth_headers(client, sa.email)
    r = client.get(f"/api/v1/projects/{project.id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["my_role"] == "admin"


def test_effective_role_explicit_member(client, db, org, ws, space, project):
    """Explicit project member with role=member sees my_role=member."""
    member = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, member, role="member")
    _add_project_member(db, project, member, role="member")
    headers = auth_headers(client, member.email)
    r = client.get(f"/api/v1/projects/{project.id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["my_role"] == "member"


# ── list_projects — space admin visibility ────────────────────────────────────

def test_list_projects_space_admin_sees_space_projects(client, db, org, ws, space, project):
    """Space admin sees all projects in their space in the workspace project list."""
    sa = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, sa, role="member")
    _add_space_member(db, space, sa, role="admin")
    headers = auth_headers(client, sa.email)
    r = client.get(f"/api/v1/workspaces/{ws.id}/projects", headers=headers)
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert str(project.id) in ids


def test_list_projects_space_admin_role_shown_as_admin(client, db, org, ws, space, project):
    """my_role in project list shows 'admin' for space admin."""
    sa = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, sa, role="member")
    _add_space_member(db, space, sa, role="admin")
    headers = auth_headers(client, sa.email)
    r = client.get(f"/api/v1/workspaces/{ws.id}/projects", headers=headers)
    assert r.status_code == 200
    proj_data = next(p for p in r.json() if p["id"] == str(project.id))
    assert proj_data["my_role"] == "admin"


# ── add_project_member — block higher-level admins ────────────────────────────

def test_add_project_member_allows_org_admin_when_actor_outranks(client, db, org, ws, space, project, owner):
    """Org owner can add an org admin as an explicit project member (hierarchy allows it)."""
    org_admin = _make_org_member(db, org, role="admin")
    headers = auth_headers(client, owner.email)
    r = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(org_admin.id), "role": "member"},
        headers=headers,
    )
    assert r.status_code == 201
    assert r.json()["role"] == "member"


def test_add_project_member_blocks_peer_project_admin(client, db, org, ws, space, project, owner):
    """Project admin cannot add or change roles for a peer project admin."""
    peer_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, peer_admin, role="member")
    _add_project_member(db, project, peer_admin, role="admin")
    actor = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, actor, role="member")
    _add_project_member(db, project, actor, role="admin")
    headers = auth_headers(client, actor.email)
    r = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(peer_admin.id), "role": "viewer"},
        headers=headers,
    )
    assert r.status_code == 403, r.text


def test_add_project_member_blocks_higher_rank_target(client, db, org, ws, space, project, owner):
    """Project admin cannot add a space admin to the project."""
    sa = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, sa, role="member")
    _add_space_member(db, space, sa, role="admin")
    proj_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, proj_admin, role="member")
    _add_project_member(db, project, proj_admin, role="admin")
    headers = auth_headers(client, proj_admin.email)
    r = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(sa.id), "role": "member"},
        headers=headers,
    )
    assert r.status_code == 403


def test_add_project_member_blocks_ws_admin(client, db, org, ws, space, project, owner):
    """Project admin cannot add a workspace admin when outranked."""
    ws_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, ws_admin, role="admin")
    proj_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, proj_admin, role="member")
    _add_project_member(db, project, proj_admin, role="admin")
    headers = auth_headers(client, proj_admin.email)
    r = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(ws_admin.id), "role": "viewer"},
        headers=headers,
    )
    assert r.status_code == 403


def test_org_owner_can_add_space_admin_as_project_member(client, db, org, ws, space, project, owner):
    """Org owner can add a space admin as explicit project member (outranks target)."""
    sa = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, sa, role="member")
    _add_space_member(db, space, sa, role="admin")
    headers = auth_headers(client, owner.email)
    r = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(sa.id), "role": "member"},
        headers=headers,
    )
    assert r.status_code == 201
    assert r.json()["role"] == "member"


def test_add_project_member_allows_plain_member(client, db, org, ws, space, project, owner):
    """Plain workspace member (no admin role anywhere) can be added as project member."""
    plain = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, plain, role="member")
    headers = auth_headers(client, owner.email)
    r = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(plain.id), "role": "member"},
        headers=headers,
    )
    assert r.status_code == 201
    assert r.json()["role"] == "member"


# ── space member endpoints ────────────────────────────────────────────────────

def test_list_space_members(client, db, org, ws, space, owner):
    """Owner can list space members."""
    member = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, member, role="member")
    _add_space_member(db, space, member, role="member")
    headers = auth_headers(client, owner.email)
    r = client.get(f"/api/v1/spaces/{space.id}/members", headers=headers)
    assert r.status_code == 200
    ids = [m["user_id"] for m in r.json()]
    assert str(member.id) in ids


def test_add_space_member_direct(client, db, org, ws, space, owner):
    """Space admin can directly add an org member to the space."""
    new_member = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, new_member, role="member")
    headers = auth_headers(client, owner.email)
    r = client.post(
        f"/api/v1/spaces/{space.id}/members",
        json={"user_id": str(new_member.id), "role": "member"},
        headers=headers,
    )
    assert r.status_code == 201
    assert r.json()["role"] == "member"


def test_add_space_member_duplicate_409(client, db, org, ws, space, owner):
    """Adding the same user twice returns 409."""
    member = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, member, role="member")
    _add_space_member(db, space, member, role="member")
    headers = auth_headers(client, owner.email)
    r = client.post(
        f"/api/v1/spaces/{space.id}/members",
        json={"user_id": str(member.id), "role": "member"},
        headers=headers,
    )
    assert r.status_code == 409


def test_update_space_member_role(client, db, org, ws, space, owner):
    """Space admin can promote a member to admin."""
    member = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, member, role="member")
    _add_space_member(db, space, member, role="member")
    headers = auth_headers(client, owner.email)
    r = client.patch(
        f"/api/v1/spaces/{space.id}/members/{member.id}",
        json={"role": "admin"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_remove_space_member(client, db, org, ws, space, owner):
    """Space admin can remove a space member."""
    member = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, member, role="member")
    _add_space_member(db, space, member, role="member")
    headers = auth_headers(client, owner.email)
    r = client.delete(f"/api/v1/spaces/{space.id}/members/{member.id}", headers=headers)
    assert r.status_code == 200
    sm = db.scalar(select(SpaceMember).where(
        SpaceMember.space_id == space.id, SpaceMember.user_id == member.id
    ))
    assert sm is None


def test_space_member_cannot_remove_others(client, db, org, ws, space, owner):
    """A plain space member cannot remove other members (requires space admin)."""
    plain = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, plain, role="member")
    _add_space_member(db, space, plain, role="member")
    other = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, other, role="member")
    _add_space_member(db, space, other, role="member")
    headers = auth_headers(client, plain.email)
    r = client.delete(f"/api/v1/spaces/{space.id}/members/{other.id}", headers=headers)
    assert r.status_code == 403


# ── create_project — creator always gets explicit admin row ───────────────────

def test_create_project_org_admin_gets_explicit_admin_row(client, db, org, ws, space, owner):
    """Org admin creating a project is listed as an explicit project admin."""
    admin = _make_org_member(db, org, role="admin")
    _add_ws_member(db, ws, admin, role="member")
    headers = auth_headers(client, admin.email)
    r = client.post(
        f"/api/v1/spaces/{space.id}/projects",
        json={"name": "Admin Project", },
        headers=headers,
    )
    assert r.status_code == 201
    project_id = r.json()["id"]
    pm = db.scalar(select(ProjectMember).where(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == admin.id,
    ))
    assert pm is not None
    assert pm.role == "admin"
    assert r.json()["my_explicit_role"] == "admin"
    r2 = client.get(f"/api/v1/projects/{project_id}", headers=headers)
    assert r2.status_code == 200
    assert r2.json()["my_role"] == "admin"


# ── org invite — org admin can invite ─────────────────────────────────────────

def test_org_admin_can_invite_to_org(client, db, org, owner):
    """Org admin (not just owner) can send org-scoped invites."""
    admin = _make_org_member(db, org, role="admin")
    headers = auth_headers(client, admin.email)
    r = client.post(
        f"/api/v1/organizations/{org.id}/invites",
        json={"email": "new_via_admin@test.dev", "role": "member"},
        headers=headers,
    )
    assert r.status_code == 201


def test_org_member_cannot_invite_to_org(client, db, org, owner):
    """Plain org member cannot send org-scoped invites."""
    member = _make_org_member(db, org, role="member")
    headers = auth_headers(client, member.email)
    r = client.post(
        f"/api/v1/organizations/{org.id}/invites",
        json={"email": "sneaky@test.dev", "role": "member"},
        headers=headers,
    )
    assert r.status_code == 403


def test_org_owner_can_manage_project_member_without_explicit_project_row(client, db, org, owner, ws, space, project):
    """Org owner has implicit project admin; must manage members without a ProjectMember row."""
    proj_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, proj_admin, role="member")
    _add_project_member(db, project, proj_admin, role="admin")
    db.delete(
        db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == owner.id,
            )
        )
    )
    db.flush()

    headers = auth_headers(client, owner.email)
    r = client.patch(
        f"/api/v1/projects/{project.id}/members/{proj_admin.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert r.status_code == 200, r.text
    assert (
        db.scalar(
            select(ProjectMember.role).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == proj_admin.id,
            )
        )
        == "member"
    )


def test_org_owner_can_remove_project_admin_without_explicit_project_row(client, db, org, owner, ws, space, project):
    """Org owner can remove a project admin without holding an explicit ProjectMember row."""
    proj_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, proj_admin, role="member")
    _add_project_member(db, project, proj_admin, role="admin")
    db.delete(
        db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == owner.id,
            )
        )
    )
    db.flush()

    headers = auth_headers(client, owner.email)
    r = client.delete(
        f"/api/v1/projects/{project.id}/members/{proj_admin.id}",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert (
        db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == proj_admin.id,
            )
        )
        is None
    )


def test_workspace_admin_can_manage_project_member_without_explicit_project_row(
    client, db, org, owner, ws, space, project
):
    """Workspace admin has implicit project admin; can demote project admins."""
    ws_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, ws_admin, role="admin")
    proj_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, proj_admin, role="member")
    _add_project_member(db, project, proj_admin, role="admin")
    headers = auth_headers(client, ws_admin.email)
    r = client.patch(
        f"/api/v1/projects/{project.id}/members/{proj_admin.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert r.status_code == 200, r.text


def test_space_admin_can_remove_project_member(client, db, org, owner, ws, space, project):
    """Space admin outranks project member and has implicit project admin."""
    space_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, space_admin, role="member")
    _add_space_member(db, space, space_admin, role="admin")
    target = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, target, role="member")
    _add_project_member(db, project, target, role="member")
    headers = auth_headers(client, space_admin.email)
    r = client.delete(
        f"/api/v1/projects/{project.id}/members/{target.id}",
        headers=headers,
    )
    assert r.status_code == 200, r.text


def test_project_admin_cannot_demote_peer_project_admin(client, db, org, owner, ws, space, project):
    """Peer project admins are protected by the role hierarchy."""
    peer = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, peer, role="member")
    _add_project_member(db, project, peer, role="admin")
    actor = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, actor, role="member")
    _add_project_member(db, project, actor, role="admin")
    headers = auth_headers(client, actor.email)
    r = client.patch(
        f"/api/v1/projects/{project.id}/members/{peer.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert r.status_code == 403, r.text


def test_org_admin_can_demote_org_member_via_org_endpoint(client, db, org, owner):
    """Org admin can change a plain org member's organization role."""
    org_admin = _make_org_member(db, org, role="admin")
    target = _make_org_member(db, org, role="member")
    headers = auth_headers(client, org_admin.email)
    r = client.patch(
        f"/api/v1/organizations/{org.id}/members/{target.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert r.status_code == 200, r.text


def test_org_admin_cannot_demote_peer_org_admin(client, db, org, owner):
    """Org admins cannot manage peers at the same hierarchy level."""
    org_admin = _make_org_member(db, org, role="admin")
    peer = _make_org_member(db, org, role="admin")
    headers = auth_headers(client, org_admin.email)
    r = client.patch(
        f"/api/v1/organizations/{org.id}/members/{peer.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert r.status_code == 403, r.text


def test_org_owner_can_remove_last_project_admin(client, db, org, owner, ws, space, project):
    """Org owner bypasses the only-project-admin guard."""
    only_admin = _make_org_member(db, org, role="member")
    _add_ws_member(db, ws, only_admin, role="member")
    _add_project_member(db, project, only_admin, role="admin")
    db.delete(
        db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == owner.id,
            )
        )
    )
    db.flush()
    headers = auth_headers(client, owner.email)
    r = client.delete(
        f"/api/v1/projects/{project.id}/members/{only_admin.id}",
        headers=headers,
    )
    assert r.status_code == 200, r.text
