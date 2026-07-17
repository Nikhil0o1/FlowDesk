"""Integration — GitHub connection status, branch names, and task events."""
from unittest.mock import patch

import pytest

from app.models.github import GithubRepository
from app.services import github_service
from app.tests.conftest import auth_headers
from app.core.task_ref import format_task_ref
from app.tests.helpers import add_task, build_project_stack, seed_personal_github


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.verify_token", return_value=True)
def test_github_personal_connection_status(mock_verify, client, db, org, owner):
    seed_personal_github(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/github/organizations/{org.id}/personal-connection", headers=headers)
    assert response.status_code == 200
    assert response.json()["connected"] is True
    assert response.json()["github_user_login"] == "dev-user"


@pytest.mark.integration
def test_github_suggested_branch_name(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="BRN")
    seed_personal_github(db, org, owner)
    task = add_task(db, project, owner, title="Fix login", number=9)
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/github/tasks/{task.id}/branch-name", headers=headers)
    assert response.status_code == 200
    assert format_task_ref(project.id, 9).lower() in response.json()["branch_name"].lower()


@pytest.mark.integration
def test_github_task_events_list(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="EVT")
    task = add_task(db, project, owner, title="Event task", number=3)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88801,
        repo_full_name="acme/evt",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    github_service.process_event(
        db,
        "push",
        "delivery-evt-1",
        {
            "repository": {"id": 88801, "html_url": "https://github.com/acme/evt"},
            "ref": "refs/heads/main",
            "commits": [{"message": f"{format_task_ref(project.id, 3)} update"}],
            "sender": {"login": "dev1"},
        },
    )
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/github/tasks/{task.id}/events", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


@pytest.mark.integration
@patch("app.services.github_api_service.revoke_authorization")
@patch("app.services.github_api_service.revoke_token")
def test_github_disconnect_personal(mock_revoke_token, mock_revoke_grant, client, db, org, owner):
    seed_personal_github(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.delete(f"/api/v1/github/organizations/{org.id}/personal-connection", headers=headers)
    assert response.status_code == 200

    status = client.get(f"/api/v1/github/organizations/{org.id}/personal-connection", headers=headers)
    assert status.json()["connected"] is False
