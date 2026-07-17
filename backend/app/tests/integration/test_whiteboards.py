"""Phase 3 integration — whiteboard CRUD and project-scoped ACL."""
import pytest

from app.models.organization import OrganizationMember
from app.models.whiteboard import Whiteboard
from app.models.workspace import WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, build_project_stack


def _add_outsider(db, org, workspace, email: str):
    """A workspace member who is NOT a member of the project."""
    user = make_user(db, email)
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="member"))
    db.flush()
    return user


@pytest.mark.integration
def test_whiteboard_crud_flow(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/whiteboards",
        headers=headers,
        json={"name": "Sprint Planning", "project_id": str(project.id)},
    )
    assert create.status_code == 201, create.text
    board_id = create.json()["id"]
    assert create.json()["project_id"] == str(project.id)

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/whiteboards", headers=headers)
    assert listed.status_code == 200
    assert any(b["id"] == board_id for b in listed.json())

    patch = client.patch(
        f"/api/v1/whiteboards/{board_id}",
        headers=headers,
        json={"name": "Sprint Plan", "content": {"elements": [{"id": "1", "type": "rectangle"}]}},
    )
    assert patch.status_code == 200
    assert patch.json()["element_count"] == 1

    dup = client.post(f"/api/v1/whiteboards/{board_id}/duplicate", headers=headers)
    assert dup.status_code == 201
    assert "copy" in dup.json()["name"].lower()

    delete = client.delete(f"/api/v1/whiteboards/{board_id}", headers=headers)
    assert delete.status_code == 200
    board = db.get(Whiteboard, board_id)
    assert board.deleted_at is not None


@pytest.mark.integration
def test_whiteboard_requires_project(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/whiteboards",
        headers=headers,
        json={"name": "No project"},
    )
    assert create.status_code == 422


@pytest.mark.integration
def test_project_member_can_edit_but_not_delete(client, db, org, owner):
    """Any project member may edit a board (collaborative), but only admins delete it."""
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "wb-member@test.dev")
    owner_headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/whiteboards",
        headers=owner_headers,
        json={"name": "Owner Board", "project_id": str(project.id)},
    )
    board_id = create.json()["id"]

    member_headers = auth_headers(client, member.email)
    patch = client.patch(
        f"/api/v1/whiteboards/{board_id}",
        headers=member_headers,
        json={"name": "Collaboratively edited"},
    )
    assert patch.status_code == 200

    # A plain project member cannot delete — deletion is admin-only.
    delete = client.delete(f"/api/v1/whiteboards/{board_id}", headers=member_headers)
    assert delete.status_code == 403


@pytest.mark.integration
def test_non_project_member_cannot_see_whiteboard(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    outsider = _add_outsider(db, org, workspace, "wb-outsider@test.dev")
    owner_headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/whiteboards",
        headers=owner_headers,
        json={"name": "Private Board", "project_id": str(project.id)},
    )
    board_id = create.json()["id"]

    outsider_headers = auth_headers(client, outsider.email)
    # Not listed for a workspace member who isn't in the project.
    listed = client.get(f"/api/v1/workspaces/{workspace.id}/whiteboards", headers=outsider_headers)
    assert listed.status_code == 200
    assert all(b["id"] != board_id for b in listed.json())
    # And cannot be opened directly.
    got = client.get(f"/api/v1/whiteboards/{board_id}", headers=outsider_headers)
    assert got.status_code in (403, 404)


@pytest.mark.integration
def test_whiteboard_rejects_too_many_elements(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/whiteboards",
        headers=headers,
        json={"name": "Huge", "project_id": str(project.id)},
    )
    board_id = create.json()["id"]
    elements = [{"id": str(i), "type": "rectangle"} for i in range(5001)]

    patch = client.patch(
        f"/api/v1/whiteboards/{board_id}",
        headers=headers,
        json={"content": {"elements": elements}},
    )
    assert patch.status_code == 422
