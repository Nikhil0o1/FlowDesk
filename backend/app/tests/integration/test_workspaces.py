"""Phase 3 integration — workspace CRUD and membership."""
import pytest

from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack


@pytest.mark.integration
def test_list_and_create_workspace(client, db, org, owner):
    headers = auth_headers(client, owner.email)

    listed = client.get(f"/api/v1/organizations/{org.id}/workspaces", headers=headers)
    assert listed.status_code == 200

    created = client.post(
        f"/api/v1/organizations/{org.id}/workspaces",
        headers=headers,
        json={"name": "New Workspace", "description": "Test"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["name"] == "New Workspace"
    assert created.json()["my_role"] == "owner"


@pytest.mark.integration
def test_member_cannot_create_workspace(client, db, org, owner):
    member = make_user(db, "ws-member@test.dev")
    from app.models.organization import OrganizationMember

    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()

    response = client.post(
        f"/api/v1/organizations/{org.id}/workspaces",
        headers=auth_headers(client, member.email),
        json={"name": "Blocked"},
    )
    assert response.status_code == 403


@pytest.mark.integration
def test_patch_workspace_admin_only(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    patch = client.patch(
        f"/api/v1/workspaces/{workspace.id}",
        headers=headers,
        json={"name": "Renamed WS"},
    )
    assert patch.status_code == 200
    assert patch.json()["name"] == "Renamed WS"


@pytest.mark.integration
def test_list_workspace_members(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    members = client.get(f"/api/v1/workspaces/{workspace.id}/members", headers=headers)
    assert members.status_code == 200
    assert len(members.json()) >= 1


@pytest.mark.integration
def test_list_workspace_my_role_reflects_membership_not_org_role(client, db, org, owner):
    """Org admins see workspace membership role on the list, not blanket org admin."""
    workspace, _ = build_project_stack(db, org, owner)
    from app.models.organization import OrganizationMember

    org_admin = make_user(db, "org-admin-ws@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=org_admin.id, role="member"))
    db.flush()

    headers = auth_headers(client, org_admin.email)
    listed = client.get(f"/api/v1/organizations/{org.id}/workspaces", headers=headers)
    assert listed.status_code == 200
    roles = {row["id"]: row["my_role"] for row in listed.json()}
    assert roles[str(workspace.id)] == "member"

    patch = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{org_admin.id}",
        headers=auth_headers(client, owner.email),
        json={"role": "admin"},
    )
    assert patch.status_code == 200

    listed_after = client.get(f"/api/v1/organizations/{org.id}/workspaces", headers=headers)
    roles_after = {row["id"]: row["my_role"] for row in listed_after.json()}
    assert roles_after[str(workspace.id)] == "admin"

    demote = client.patch(
        f"/api/v1/workspaces/{workspace.id}/members/{org_admin.id}",
        headers=auth_headers(client, owner.email),
        json={"role": "member"},
    )
    assert demote.status_code == 200

    listed_final = client.get(f"/api/v1/organizations/{org.id}/workspaces", headers=headers)
    roles_final = {row["id"]: row["my_role"] for row in listed_final.json()}
    assert roles_final[str(workspace.id)] == "member"


@pytest.mark.integration
def test_list_workspace_members_includes_org_leaders_without_workspace_row(client, db, org, owner):
    """Workspace admins must see org owner/admin in All People even without a WorkspaceMember row."""
    workspace, _ = build_project_stack(db, org, owner)
    from app.models.organization import OrganizationMember

    org_admin = make_user(db, "org-admin-people@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    ws_admin = make_user(db, "ws-admin-people@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, ws_admin.email)
    response = client.get(f"/api/v1/workspaces/{workspace.id}/members", headers=headers)
    assert response.status_code == 200
    by_user = {row["user_id"]: row["role"] for row in response.json()}
    assert str(owner.id) in by_user
    assert by_user[str(owner.id)] == "owner"
    assert str(org_admin.id) in by_user
    assert by_user[str(org_admin.id)] == "org_admin"
    assert str(ws_admin.id) in by_user


@pytest.mark.integration
def test_workspace_member_candidates_excludes_org_leaders_includes_workspace_members(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    from app.models.organization import OrganizationMember

    plain = make_user(db, "plain-ws@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=plain.id, role="member"))
    org_admin = make_user(db, "org-admin-cand@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    ws_admin = make_user(db, "ws-admin-cand@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, ws_admin.email)
    response = client.get(f"/api/v1/workspaces/{workspace.id}/member-candidates", headers=headers)
    assert response.status_code == 200
    ids = {row["user_id"] for row in response.json()}
    assert str(plain.id) in ids
    plain_row = next(row for row in response.json() if row["user_id"] == str(plain.id))
    assert plain_row["org_role"] == "member"
    assert plain_row["workspaces"] == []
    assert plain_row["spaces"] == []
    assert plain_row["projects"] == []
    assert str(org_admin.id) not in ids
    assert str(owner.id) not in ids
    assert str(ws_admin.id) in ids


@pytest.mark.integration
def test_workspace_member_candidates_includes_space_and_project_members(client, db, org, owner):
    """Members already assigned to a space/project stay visible for further assignments."""
    from sqlalchemy import select

    from app.models.organization import OrganizationMember
    from app.models.project import Space, SpaceMember

    workspace, _project = build_project_stack(db, org, owner)
    space = db.scalar(select(Space).where(Space.workspace_id == workspace.id))

    assigned = make_user(db, "assigned@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=assigned.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=assigned.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=assigned.id, role="admin"))
    db.flush()

    ws_admin = make_user(db, "ws-admin-assign@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, ws_admin.email)
    response = client.get(f"/api/v1/workspaces/{workspace.id}/member-candidates", headers=headers)
    assert response.status_code == 200
    row = next(r for r in response.json() if r["user_id"] == str(assigned.id))
    assert len(row["spaces"]) == 1
    assert row["spaces"][0]["space_name"] == "Space"
    assert row["spaces"][0]["role"] == "admin"
    assert row["projects"] == []


@pytest.mark.integration
def test_workspace_member_candidates_includes_org_member_from_other_workspace(client, db, org, owner):
    """Org members in another workspace should still appear as add candidates."""
    from app.models.organization import OrganizationMember
    from app.models.workspace import Workspace, WorkspaceMember

    workspace_a, _ = build_project_stack(db, org, owner)
    workspace_b = Workspace(organization_id=org.id, name="Workspace B", created_by=owner.id)
    db.add(workspace_b)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace_b.id, user_id=owner.id, role="admin"))

    other_ws_member = make_user(db, "other-ws@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=other_ws_member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace_b.id, user_id=other_ws_member.id, role="member"))

    ws_admin = make_user(db, "ws-a-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace_a.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, ws_admin.email)
    response = client.get(f"/api/v1/workspaces/{workspace_a.id}/member-candidates", headers=headers)
    assert response.status_code == 200
    ids = {row["user_id"] for row in response.json()}
    assert str(other_ws_member.id) in ids
    other_row = next(row for row in response.json() if row["user_id"] == str(other_ws_member.id))
    assert len(other_row["workspaces"]) == 1
    assert other_row["workspaces"][0]["workspace_name"] == "Workspace B"
    assert other_row["workspaces"][0]["role"] == "member"
    assert str(owner.id) not in ids


@pytest.mark.integration
def test_workspace_member_candidates_show_scoped_roles_from_other_workspace(client, db, org, owner):
    """A space-admin role in another workspace is visible in this workspace's picker."""
    from sqlalchemy import select

    from app.models.organization import OrganizationMember
    from app.models.project import Space, SpaceMember
    from app.models.workspace import Workspace, WorkspaceMember

    workspace_a, _ = build_project_stack(db, org, owner, project_key="WSA")
    workspace_b, _ = build_project_stack(db, org, owner, project_key="WSB")
    space_b = db.scalar(select(Space).where(Space.workspace_id == workspace_b.id))

    # X is only a plain workspace member of B but a SPACE ADMIN inside B.
    person_x = make_user(db, "x-space-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=person_x.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace_b.id, user_id=person_x.id, role="member"))
    db.add(SpaceMember(space_id=space_b.id, user_id=person_x.id, role="admin"))

    ws_admin = make_user(db, "wsa-admin-consistency@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace_a.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, ws_admin.email)
    response = client.get(f"/api/v1/workspaces/{workspace_a.id}/member-candidates", headers=headers)
    assert response.status_code == 200, response.text
    row = next(r for r in response.json() if r["user_id"] == str(person_x.id))
    assert any(sp["role"] == "admin" for sp in row["spaces"]), row["spaces"]


@pytest.mark.integration
def test_workspace_member_candidates_allowed_for_project_admin(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PAD")
    from app.models.organization import OrganizationMember
    from app.models.project import ProjectMember

    plain = make_user(db, "plain-pa@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=plain.id, role="member"))
    project_admin = make_user(db, "project-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=project_admin.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=project_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, project_admin.email)
    response = client.get(f"/api/v1/workspaces/{workspace.id}/member-candidates", headers=headers)
    assert response.status_code == 200
    ids = {row["user_id"] for row in response.json()}
    assert str(plain.id) in ids
    assert str(owner.id) not in ids


@pytest.mark.integration
def test_workspace_task_stats(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    from app.models.task import CustomStatus
    from app.tests.helpers import add_task

    status = CustomStatus(project_id=project.id, name="Open", color="#ccc", position=1)
    db.add(status)
    db.flush()
    task = add_task(db, project, owner, title="Counted")
    task.status_id = status.id
    db.flush()
    headers = auth_headers(client, owner.email)

    stats = client.get(f"/api/v1/workspaces/{workspace.id}/task-stats", headers=headers)
    assert stats.status_code == 200
    assert stats.json()["total"] >= 1


@pytest.mark.integration
def test_workspace_member_candidates_tolerates_personal_projects(client, db, org, owner):
    """Personal list projects (spaceless, is_personal) must neither 500 the
    endpoint nor leak into a candidate's project memberships."""
    from app.models.organization import OrganizationMember
    from app.models.project import Project, ProjectMember

    workspace, _project = build_project_stack(db, org, owner)

    candidate = make_user(db, "personal-list@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=candidate.id, role="member"))
    db.flush()
    personal = Project(
        workspace_id=workspace.id,
        space_id=None,
        name="Personal List",
        created_by=candidate.id,
        is_personal=True,
        personal_owner_id=candidate.id,
    )
    db.add(personal)
    db.flush()
    db.add(ProjectMember(project_id=personal.id, user_id=candidate.id, role="admin"))

    ws_admin = make_user(db, "pl-ws-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    response = client.get(
        f"/api/v1/workspaces/{workspace.id}/member-candidates",
        headers=auth_headers(client, ws_admin.email),
    )
    assert response.status_code == 200, response.text
    row = next(r for r in response.json() if r["user_id"] == str(candidate.id))
    assert row["projects"] == []
