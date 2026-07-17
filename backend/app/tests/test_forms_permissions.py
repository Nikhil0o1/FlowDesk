from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user


def _build_project(db, org, owner):
    workspace = Workspace(organization_id=org.id, name="Forms WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    space = Space(workspace_id=workspace.id, name="Space", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(
        space_id=space.id,
        workspace_id=workspace.id,
        name="Forms Project",
        created_by=owner.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, role="admin"))
    db.flush()
    return workspace, project


def _add_workspace_user(db, org, workspace, email, workspace_role="member"):
    user = make_user(db, email)
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=workspace_role))
    db.flush()
    return user


def test_only_admins_create_forms_and_only_project_members_submit(client, db, org, owner):
    workspace, project = _build_project(db, org, owner)
    project_member = _add_workspace_user(db, org, workspace, "project-member@test.dev")
    workspace_only = _add_workspace_user(db, org, workspace, "workspace-only@test.dev")
    db.add(ProjectMember(project_id=project.id, user_id=project_member.id, role="member"))
    db.flush()

    member_headers = auth_headers(client, "project-member@test.dev")
    blocked_create = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=member_headers,
        json={"name": "Member form", "project_id": str(project.id)},
    )
    assert blocked_create.status_code == 403

    owner_headers = auth_headers(client, "owner@test.dev")
    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=owner_headers,
        json={"name": "Project intake", "project_id": str(project.id)},
    )
    assert created.status_code == 201
    form = created.json()

    workspace_only_headers = auth_headers(client, "workspace-only@test.dev")
    assert client.get(f"/api/v1/forms/{form['id']}", headers=workspace_only_headers).status_code == 404
    # Public link is token-gated, not membership-gated — anyone with the URL can view/submit.
    assert client.get(f"/api/v1/public/forms/{form['public_token']}").status_code == 200
    assert client.get(
        f"/api/v1/public/forms/{form['public_token']}", headers=workspace_only_headers
    ).status_code == 200
    public_submit = client.post(
        f"/api/v1/public/forms/{form['public_token']}",
        json={"values": {"title": "Public request"}},
    )
    assert public_submit.status_code == 201
    blocked_submit = client.post(
        f"/api/v1/forms/{form['id']}/submit",
        headers=workspace_only_headers,
        json={"values": {"title": "Should not submit"}},
    )
    assert blocked_submit.status_code == 404

    visible_forms = client.get(f"/api/v1/workspaces/{workspace.id}/forms", headers=member_headers)
    assert visible_forms.status_code == 200
    assert [item["id"] for item in visible_forms.json()] == [form["id"]]

    allowed_submit = client.post(
        f"/api/v1/forms/{form['id']}/submit",
        headers=member_headers,
        json={"values": {"title": "Allowed request"}},
    )
    assert allowed_submit.status_code == 200
    assert allowed_submit.json()["task_ref"]
