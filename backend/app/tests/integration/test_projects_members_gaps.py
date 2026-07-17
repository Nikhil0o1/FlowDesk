"""Integration — project members, archive, and space-scoped listing."""
import pytest
from sqlalchemy import select

from app.models.organization import OrganizationMember
from app.models.project import ProjectMember, Space, SpaceMember
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, build_project_stack


@pytest.mark.integration
def test_add_project_member_via_api_adds_workspace_membership(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ADD")
    org_user = make_user(db, "org-only@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_user.id, role="member"))
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/members",
        headers=headers,
        json={"user_id": str(org_user.id), "role": "member"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["user"]["email"] == org_user.email

    ws_member = db.query(WorkspaceMember).filter_by(
        workspace_id=workspace.id, user_id=org_user.id
    ).one_or_none()
    assert ws_member is not None


@pytest.mark.integration
def test_add_project_member_rejects_outsider_and_duplicate(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    outsider = make_user(db, "outsider@test.dev")
    member = add_project_member(db, org, workspace, project, "dup-member@test.dev")
    headers = auth_headers(client, owner.email)

    not_in_org = client.post(
        f"/api/v1/projects/{project.id}/members",
        headers=headers,
        json={"user_id": str(outsider.id), "role": "member"},
    )
    assert not_in_org.status_code == 400

    duplicate = client.post(
        f"/api/v1/projects/{project.id}/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "member"},
    )
    assert duplicate.status_code == 409


@pytest.mark.integration
def test_member_candidates_excludes_org_leaders_and_existing_members(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CND")
    plain = make_user(db, "plain-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=plain.id, role="member"))
    org_admin = make_user(db, "org-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    ws_admin = make_user(db, "ws-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/projects/{project.id}/member-candidates", headers=headers)
    assert response.status_code == 200
    ids = {row["user_id"] for row in response.json()}
    assert str(plain.id) in ids
    assert str(ws_admin.id) in ids
    assert str(org_admin.id) not in ids
    assert str(owner.id) not in ids


@pytest.mark.integration
def test_create_project_always_adds_creator_as_explicit_admin(client, db, org, owner):
    """Org admins who create a project still get an explicit admin row in project_members."""
    from app.models.project import ProjectMember
    from app.models.workspace import Workspace, WorkspaceMember
    from app.models.project import Space

    workspace = Workspace(organization_id=org.id, name="WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=workspace.id, name="Space", created_by=owner.id)
    db.add(space)
    db.flush()
    headers = auth_headers(client, owner.email)

    created = client.post(
        f"/api/v1/spaces/{space.id}/projects",
        headers=headers,
        json={"name": "proje1"},
    )
    assert created.status_code == 201
    project_id = created.json()["id"]
    assert created.json()["my_explicit_role"] == "admin"

    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == owner.id,
        )
    )
    assert member is not None
    assert member.role == "admin"

    listed = client.get(f"/api/v1/projects/{project_id}/members", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["role"] == "admin"


@pytest.mark.integration
def test_project_member_cannot_add_others(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MBR")
    member = add_project_member(db, org, workspace, project, "plain-member@test.dev", role="member")
    other = make_user(db, "other@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=other.id, role="member"))
    db.flush()
    headers = auth_headers(client, member.email)

    denied = client.post(
        f"/api/v1/projects/{project.id}/members",
        headers=headers,
        json={"user_id": str(other.id), "role": "member"},
    )
    assert denied.status_code == 403

    allowed_view = client.get(f"/api/v1/projects/{project.id}/members", headers=headers)
    assert allowed_view.status_code == 200


@pytest.mark.integration
def test_list_projects_filtered_by_space_and_archive(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SPA")
    headers = auth_headers(client, owner.email)
    other_space = client.post(
        f"/api/v1/workspaces/{workspace.id}/spaces",
        headers=headers,
        json={"name": "Other space"},
    ).json()["id"]
    other_project = client.post(
        f"/api/v1/spaces/{other_space}/projects",
        headers=headers,
        json={"name": "Isolated", },
    ).json()["id"]

    filtered = client.get(
        f"/api/v1/workspaces/{workspace.id}/projects",
        headers=headers,
        params={"space_id": other_space},
    )
    assert filtered.status_code == 200
    ids = {p["id"] for p in filtered.json()}
    assert other_project in ids
    assert str(project.id) not in ids

    archived = client.patch(
        f"/api/v1/projects/{project.id}",
        headers=headers,
        json={"is_archived": True},
    )
    assert archived.status_code == 200
    assert archived.json()["is_archived"] is True


@pytest.mark.integration
def test_space_not_found_returns_404(client, db, org, owner):
    import uuid

    headers = auth_headers(client, owner.email)
    missing = uuid.uuid4()

    update = client.patch(f"/api/v1/spaces/{missing}", headers=headers, json={"name": "Nope"})
    assert update.status_code == 404

    delete = client.delete(f"/api/v1/spaces/{missing}", headers=headers)
    assert delete.status_code == 404


@pytest.mark.integration
def test_project_admin_can_change_member_role(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ROL")
    member = add_project_member(db, org, workspace, project, "role-target@test.dev", role="member")
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/projects/{project.id}/members/{member.id}",
        headers=headers,
        json={"role": "viewer"},
    )
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"


@pytest.mark.integration
def test_project_admin_cannot_change_own_role(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SELF")
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/projects/{project.id}/members/{owner.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert response.status_code == 403


@pytest.mark.integration
def test_project_admin_cannot_remove_self(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="RMV")
    headers = auth_headers(client, owner.email)

    response = client.delete(
        f"/api/v1/projects/{project.id}/members/{owner.id}",
        headers=headers,
    )
    assert response.status_code == 403


@pytest.mark.integration
def test_project_member_cannot_change_or_remove_others(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MBR")
    member = add_project_member(db, org, workspace, project, "plain-member@test.dev", role="member")
    other = add_project_member(db, org, workspace, project, "other-member@test.dev", role="viewer")
    headers = auth_headers(client, member.email)

    patch_role = client.patch(
        f"/api/v1/projects/{project.id}/members/{other.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert patch_role.status_code == 403

    remove_other = client.delete(
        f"/api/v1/projects/{project.id}/members/{other.id}",
        headers=headers,
    )
    assert remove_other.status_code == 403


@pytest.mark.integration
def test_space_member_candidates_lists_assignable_org_members(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SPC")
    plain = make_user(db, "space-cand@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=plain.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=plain.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=plain.id, role="member"))

    space_admin = make_user(db, "space-cand-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=space_admin.id, role="member"))
    db.add(SpaceMember(space_id=project.space_id, user_id=space_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, space_admin.email)
    response = client.get(
        f"/api/v1/spaces/{project.space_id}/member-candidates",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    ids = {row["user_id"] for row in response.json()}
    assert str(plain.id) in ids
    assert str(owner.id) not in ids
    row = next(r for r in response.json() if r["user_id"] == str(plain.id))
    assert row["projects"][0]["project_name"] == project.name


@pytest.mark.integration
def test_space_member_candidates_show_roles_in_other_workspaces(client, db, org, owner):
    """A candidate who only belongs to another workspace still appears with that role."""
    workspace, _project = build_project_stack(db, org, owner, project_key="SPX")

    other_ws = Workspace(organization_id=org.id, name="Other WS", created_by=owner.id)
    db.add(other_ws)
    db.flush()

    outsider = make_user(db, "other-ws-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=outsider.id, role="member"))
    db.add(WorkspaceMember(workspace_id=other_ws.id, user_id=outsider.id, role="admin"))

    space = db.get(Space, _project.space_id)
    space_admin = make_user(db, "spx-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=space_admin.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=space_admin.id, role="admin"))
    db.flush()

    response = client.get(
        f"/api/v1/spaces/{space.id}/member-candidates",
        headers=auth_headers(client, space_admin.email),
    )
    assert response.status_code == 200, response.text
    row = next(r for r in response.json() if r["user_id"] == str(outsider.id))
    workspace_names = {w["workspace_name"] for w in row["workspaces"]}
    assert "Other WS" in workspace_names
    assert any(w["role"] == "admin" for w in row["workspaces"])


@pytest.mark.integration
def test_project_admin_can_add_existing_member_as_project_admin(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PADM")
    candidate = make_user(db, "future-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=candidate.id, role="member"))

    proj_admin = make_user(db, "pa-add-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.flush()

    headers = auth_headers(client, proj_admin.email)
    response = client.post(
        f"/api/v1/projects/{project.id}/members",
        headers=headers,
        json={"user_id": str(candidate.id), "role": "admin"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["role"] == "admin"
