"""Coverage — project spaces, lists, statuses delete paths."""
import pytest

from app.models.project import Space
from app.tests.conftest import auth_headers
from app.tests.helpers import build_project_stack


@pytest.mark.coverage
def test_space_update_and_delete(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    space = db.get(Space, project.space_id)
    headers = auth_headers(client, owner.email)

    patched = client.patch(
        f"/api/v1/spaces/{space.id}",
        headers=headers,
        json={"name": "Renamed space"},
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Renamed space"

    empty_space = client.post(
        f"/api/v1/workspaces/{workspace.id}/spaces",
        headers=headers,
        json={"name": "Disposable"},
    ).json()["id"]
    deleted = client.delete(f"/api/v1/spaces/{empty_space}", headers=headers)
    assert deleted.status_code == 200


@pytest.mark.coverage
def test_project_delete_and_list_crud(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="LST")
    headers = auth_headers(client, owner.email)

    task_list = client.post(
        f"/api/v1/projects/{project.id}/lists",
        headers=headers,
        json={"name": "Sprint backlog"},
    )
    list_id = task_list.json()["id"]

    updated = client.patch(f"/api/v1/lists/{list_id}", headers=headers, json={"name": "Backlog"})
    assert updated.status_code == 200

    status = client.post(
        f"/api/v1/projects/{project.id}/statuses",
        headers=headers,
        json={"name": "Review", "color": "#00f", "category": "in_progress"},
    )
    assert status.status_code == 201, status.text
    status_id = status.json()["id"]
    client.delete(f"/api/v1/statuses/{status_id}", headers=headers)
    client.delete(f"/api/v1/lists/{list_id}", headers=headers)

    disposable = client.post(
        f"/api/v1/spaces/{project.space_id}/projects",
        headers=headers,
        json={"name": "Temp", },
    ).json()["id"]
    assert client.delete(f"/api/v1/projects/{disposable}", headers=headers).status_code == 200
