"""Member access directory, role summary, and scoped dashboard APIs."""
import pytest
from sqlalchemy import select

from app.models.organization import OrganizationMember
from app.models.project import ProjectMember, Space, SpaceMember
from app.models.workspace import WorkspaceMember
from app.services import member_access_service as mas
from app.services import dashboard_service as ds
from app.services.permission_service import PermissionService
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack

pytestmark = pytest.mark.integration


@pytest.mark.coverage
def test_org_owner_member_access_detail(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = make_user(db, "access-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    space = db.scalar(select(Space).where(Space.workspace_id == workspace.id).limit(1))
    if space is None:
        space = Space(workspace_id=workspace.id, name="Access Space", created_by=owner.id)
        db.add(space)
        db.flush()
    db.add(SpaceMember(space_id=space.id, user_id=member.id, role="admin"))
    db.add(ProjectMember(project_id=project.id, user_id=member.id, role="member"))
    db.flush()

    headers = auth_headers(client, owner.email)
    response = client.get(
        f"/api/v1/organizations/{org.id}/members/{member.id}/access",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user_id"] == str(member.id)
    assert body["org_role"] == "member"
    assert body["highest_role"] in ("space_admin", "member", "workspace_admin")
    assert any(ws["workspace_id"] == str(workspace.id) for ws in body["workspace_access"])
    assert any(p["project_id"] == str(project.id) for p in body["project_access"])


@pytest.mark.coverage
def test_member_access_requires_org_admin(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = make_user(db, "access-plain@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()

    headers = auth_headers(client, member.email)
    response = client.get(
        f"/api/v1/organizations/{org.id}/members/{owner.id}/access",
        headers=headers,
    )
    assert response.status_code == 403


@pytest.mark.coverage
def test_users_me_roles_for_org_owner(client, db, org, owner):
    build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/users/me/roles", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["highest_role"] == "org_owner"
    assert body["org_role"] == "owner"
    assert body["org_name"] == org.name


@pytest.mark.coverage
def test_org_dashboard_endpoint(client, db, org, owner):
    build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/organizations/{org.id}/dashboard", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["organization_id"] == str(org.id)
    assert "kpis" in body
    assert body["kpis"]["workspaces"] >= 1


@pytest.mark.coverage
def test_workspace_dashboard_endpoint(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/workspaces/{workspace.id}/dashboard", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["workspace_id"] == str(workspace.id)


@pytest.mark.coverage
def test_add_workspace_member_as_org_owner(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    member = make_user(db, "ws-add-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "member"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["user_id"] == str(member.id)


@pytest.mark.coverage
def test_space_and_project_dashboard_endpoints(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    space = db.scalar(select(Space).where(Space.workspace_id == workspace.id).limit(1))
    headers = auth_headers(client, owner.email)

    space_resp = client.get(f"/api/v1/spaces/{space.id}/dashboard", headers=headers)
    assert space_resp.status_code == 200, space_resp.text
    assert space_resp.json()["space_id"] == str(space.id)

    project_resp = client.get(f"/api/v1/projects/{project.id}/dashboard", headers=headers)
    assert project_resp.status_code == 200, project_resp.text
    assert project_resp.json()["project_id"] == str(project.id)


@pytest.mark.coverage
def test_project_dashboard_activity_is_project_scoped(client, db, org, owner):
    """Regression: a project dashboard's "My Activity" must never surface the
    viewer's activity from OTHER projects in the same workspace."""
    from app.models.activity import ActivityLog
    from app.models.project import Project, ProjectMember

    workspace, project = build_project_stack(db, org, owner, project_name="Here")
    other_space = Space(workspace_id=workspace.id, name="Other Space", created_by=owner.id)
    db.add(other_space)
    db.flush()
    other = Project(
        space_id=other_space.id,
        workspace_id=workspace.id,
        name="Elsewhere",
        created_by=owner.id,
    )
    db.add(other)
    db.flush()
    db.add(ProjectMember(project_id=other.id, user_id=owner.id, role="admin"))
    db.add(ActivityLog(
        workspace_id=workspace.id, project_id=project.id, actor_id=owner.id,
        action="task.created", data={"title": "in this project"},
    ))
    db.add(ActivityLog(
        workspace_id=workspace.id, project_id=other.id, actor_id=owner.id,
        action="task.created", data={"title": "in the other project"},
    ))
    db.flush()
    headers = auth_headers(client, owner.email)

    resp = client.get(f"/api/v1/projects/{project.id}/dashboard", headers=headers)
    assert resp.status_code == 200, resp.text
    activities = resp.json()["recent_activities"]
    assert len(activities) == 1
    assert all(a["project_name"] == "Here" for a in activities)

    # Same guarantee for the space dashboard: sibling spaces must not bleed in.
    space_resp = client.get(f"/api/v1/spaces/{project.space_id}/dashboard", headers=headers)
    assert space_resp.status_code == 200, space_resp.text
    space_activities = space_resp.json()["recent_activities"]
    assert len(space_activities) == 1
    assert all(a["project_name"] == "Here" for a in space_activities)


@pytest.mark.coverage
def test_project_member_dashboard_endpoint(client, db, org, owner):
    from app.tests.helpers import add_project_member

    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "dash-member@test.dev", role="member")
    headers = auth_headers(client, member.email)

    roles_resp = client.get("/api/v1/users/me/roles", headers=headers)
    assert roles_resp.status_code == 200, roles_resp.text
    assert roles_resp.json()["highest_role"] == "project_member"

    response = client.get(f"/api/v1/projects/{project.id}/member-dashboard", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project_id"] == str(project.id)
    assert body["my_role"] == "member"
    assert "kpis" in body
    assert body["kpis"]["my_open_tasks"] == 0


@pytest.mark.coverage
def test_resolve_user_roles_for_member_service(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    admin = make_user(db, "svc-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=admin.id, role="admin"))
    db.flush()

    summary = mas.resolve_user_roles_for_member(
        db, org.id, admin.id, org.name, "admin"
    )
    assert summary.highest_role == "org_admin"
    assert summary.org_role == "admin"

    detail = mas.build_member_access_detail(
        db, PermissionService(db, owner), org.id, admin.id
    )
    assert detail.org_role == "admin"
    assert detail.can_manage_org_role is True

    roles = ds.resolve_user_roles(db, PermissionService(db, owner), org.id)
    assert roles.highest_role == "org_owner"
