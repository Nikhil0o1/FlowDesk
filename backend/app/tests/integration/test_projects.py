"""Phase 3 integration — project & space CRUD, members, lists, statuses."""
import pytest

from app.models.project import Space
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, build_project_stack


@pytest.mark.integration
def test_space_and_project_crud(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    space = db.get(Space, project.space_id)
    headers = auth_headers(client, owner.email)

    spaces = client.get(f"/api/v1/workspaces/{workspace.id}/spaces", headers=headers)
    assert spaces.status_code == 200
    assert len(spaces.json()) >= 1

    new_space = client.post(
        f"/api/v1/workspaces/{workspace.id}/spaces",
        headers=headers,
        json={"name": "Backlog Space"},
    )
    assert new_space.status_code == 201
    space_id = new_space.json()["id"]

    created = client.post(
        f"/api/v1/spaces/{space_id}/projects",
        headers=headers,
        json={"name": "Mobile App"},
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]

    detail = client.get(f"/api/v1/projects/{project_id}", headers=headers)
    assert detail.status_code == 200

    patch = client.patch(
        f"/api/v1/projects/{project_id}",
        headers=headers,
        json={"name": "Mobile App v2"},
    )
    assert patch.status_code == 200
    assert patch.json()["name"] == "Mobile App v2"


@pytest.mark.integration
def test_project_member_add_and_remove(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "proj-member@test.dev")
    headers = auth_headers(client, owner.email)

    listed = client.get(f"/api/v1/projects/{project.id}/members", headers=headers)
    assert listed.status_code == 200
    assert any(m["user_id"] == str(member.id) for m in listed.json())

    remove = client.delete(
        f"/api/v1/projects/{project.id}/members/{member.id}",
        headers=headers,
    )
    assert remove.status_code == 200
    remaining = client.get(f"/api/v1/projects/{project.id}/members", headers=headers)
    assert all(m["user_id"] != str(member.id) for m in remaining.json())


@pytest.mark.integration
def test_project_lists_and_statuses(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    lists = client.get(f"/api/v1/projects/{project.id}/lists", headers=headers)
    assert lists.status_code == 200

    new_list = client.post(
        f"/api/v1/projects/{project.id}/lists",
        headers=headers,
        json={"name": "Bugs"},
    )
    assert new_list.status_code == 201

    create_status = client.post(
        f"/api/v1/projects/{project.id}/statuses",
        headers=headers,
        json={"name": "In Progress", "color": "#00f", "category": "in_progress"},
    )
    assert create_status.status_code == 201

    statuses = client.get(f"/api/v1/projects/{project.id}/statuses", headers=headers)
    assert statuses.status_code == 200
    assert len(statuses.json()) >= 1


@pytest.mark.integration
def test_outsider_cannot_view_project(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    outsider = make_user(db, "proj-outsider@test.dev")
    headers = auth_headers(client, outsider.email)

    assert client.get(f"/api/v1/projects/{project.id}", headers=headers).status_code == 404

