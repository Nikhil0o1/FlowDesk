"""Integration — merge/close pull requests from FlowDesk and viewer restrictions."""
from unittest.mock import patch

import pytest

from app.core.task_ref import format_task_ref
from app.tests.conftest import auth_headers
from app.tests.helpers import (
    add_project_member,
    add_task,
    build_project_stack,
    seed_github_repo,
    seed_project_github,
)


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.merge_pull_request")
@patch("app.api.v1.github.github_api_service.list_pull_requests")
@patch("app.api.v1.github.github_api_service.get_pull_request")
def test_merge_task_pull_request(mock_get, mock_list, mock_merge, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MRG")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Merge PR", number=3)
    task_ref = format_task_ref(project.id, 3)
    headers = auth_headers(client, owner.email)
    mock_list.return_value = [
        {
            "number": 9,
            "title": f"{task_ref} Fix",
            "html_url": "https://github.com/acme/app/pull/9",
            "state": "open",
            "merged": False,
            "body": "",
        }
    ]
    mock_get.return_value = mock_list.return_value[0]
    mock_merge.return_value = {"merged": True, "html_url": "https://github.com/acme/app/pull/9"}

    listed = client.get(f"/api/v1/github/tasks/{task.id}/pull-requests", headers=headers)
    assert listed.status_code == 200
    assert listed.json()[0]["number"] == 9

    merged = client.post(
        f"/api/v1/github/tasks/{task.id}/pull-requests/9/merge",
        headers=headers,
        json={"repository_id": str(repo.id)},
    )
    assert merged.status_code == 200
    assert merged.json()["number"] == 9
    mock_merge.assert_called_once()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.close_pull_request")
def test_close_task_pull_request(mock_close, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLS")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Close PR", number=4)
    headers = auth_headers(client, owner.email)
    mock_close.return_value = {
        "number": 11,
        "html_url": "https://github.com/acme/app/pull/11",
        "state": "closed",
    }

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/pull-requests/11/close",
        headers=headers,
        json={"repository_id": str(repo.id)},
    )
    assert response.status_code == 200
    mock_close.assert_called_once()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_branch")
def test_project_viewer_cannot_create_branch(mock_branch, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="VWR")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    viewer = add_project_member(db, org, workspace, project, "viewer@test.dev", role="viewer")
    task = add_task(db, project, owner, title="Viewer task", number=5)
    headers = auth_headers(client, viewer.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/create-branch",
        headers=headers,
        json={"repository_id": str(repo.id), "branch_name": "feature/x"},
    )
    assert response.status_code == 403
    mock_branch.assert_not_called()
