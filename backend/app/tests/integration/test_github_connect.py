"""Integration — GitHub project connection, repo linking, and task commands."""
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.github import GithubEvent, GithubRepository
from app.models.task import CustomStatus
from app.core.task_ref import format_task_ref
from app.services import github_service
from app.tests.conftest import auth_headers
from app.tests.helpers import (
    add_project_member,
    add_task,
    build_project_stack,
    seed_github_repo,
    seed_personal_github,
    seed_project_github,
)


@pytest.mark.integration
def test_project_connection_lifecycle(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GPC")
    conn = seed_project_github(db, org, project, owner, branch_name_format=":taskId:-fix")
    headers = auth_headers(client, owner.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert status.status_code == 200
    assert status.json()["connected"] is True
    assert status.json()["can_disconnect"] is True
    assert status.json()["branch_name_format"] == ":taskId:-fix"

    patched = client.patch(
        f"/api/v1/github/projects/{project.id}/connection/settings",
        headers=headers,
        json={"branch_name_format": ":username:/:taskId:", "connected_search_enabled": False},
    )
    assert patched.status_code == 200
    assert patched.json()["connected_search_enabled"] is False

    deleted = client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers).json()["connected"] is False


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.list_accessible_repos")
def test_list_available_repos(mock_list, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_project_github(db, org, project, owner)
    mock_list.return_value = [
        {"id": 1, "full_name": "acme/app", "default_branch": "main", "private": False},
    ]
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/github/projects/{project.id}/available-repos", headers=headers)
    assert response.status_code == 200
    assert response.json()[0]["repo_full_name"] == "acme/app"


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues", return_value=[])
def test_connect_repo_creates_webhook(mock_list_issues, mock_get_repo, mock_hook, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CNR")
    seed_project_github(db, org, project, owner)
    mock_get_repo.return_value = {"id": 777, "default_branch": "main"}
    mock_hook.return_value = 55555
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/app"},
    )
    assert response.status_code == 201
    assert response.json()["repo_full_name"] == "acme/app"

    repos = client.get(f"/api/v1/github/projects/{project.id}/repositories", headers=headers)
    assert len(repos.json()) == 1


@pytest.mark.integration
def test_connect_repo_rejects_invalid_name(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_project_github(db, org, project, owner)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "bad/../name"},
    )
    assert response.status_code in (400, 422)


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues", return_value=[])
def test_connect_repo_rejects_second_repo_on_project(mock_list_issues, mock_get_repo, mock_hook, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ONE")
    seed_project_github(db, org, project, owner)
    mock_get_repo.return_value = {"id": 777, "default_branch": "main"}
    mock_hook.return_value = 55555
    headers = auth_headers(client, owner.email)

    first = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/app"},
    )
    assert first.status_code == 201

    second = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/other"},
    )
    assert second.status_code == 409


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
def test_other_project_admin_cannot_link_second_repo(mock_get_repo, mock_hook, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SEC")
    other_admin = add_project_member(db, org, workspace, project, "second-linker@test.dev", role="admin")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, repo_full_name="acme/first", connected_by=owner.id)
    mock_get_repo.return_value = {"id": 888, "default_branch": "main"}
    mock_hook.return_value = 999
    headers = auth_headers(client, other_admin.email)

    denied = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/second"},
    )
    assert denied.status_code == 403
    mock_hook.assert_not_called()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
def test_other_project_admin_cannot_link_first_repo_without_connecting_github(
    mock_get_repo, mock_hook, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="FRST")
    other_admin = add_project_member(db, org, workspace, project, "first-linker@test.dev", role="admin")
    seed_project_github(db, org, project, owner)
    mock_get_repo.return_value = {"id": 111, "default_branch": "main"}
    mock_hook.return_value = 222
    headers = auth_headers(client, other_admin.email)

    denied = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/only"},
    )
    assert denied.status_code == 403
    mock_hook.assert_not_called()

    owner_headers = auth_headers(client, owner.email)
    allowed = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=owner_headers,
        json={"repo_full_name": "acme/only"},
    )
    assert allowed.status_code == 201


@pytest.mark.integration
def test_disconnect_project_requires_repo_unlinked_first(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="UNL")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, connected_by=owner.id)
    headers = auth_headers(client, owner.email)

    blocked = client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert blocked.status_code == 409
    assert "Unlink the repository" in blocked.json()["detail"]


@pytest.mark.integration
def test_project_oauth_authorize_blocked_when_already_connected(client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    workspace, project = build_project_stack(db, org, owner, project_key="OAU")
    seed_project_github(db, org, project, owner)
    other_admin = add_project_member(db, org, workspace, project, "oauth-block@test.dev", role="admin")
    headers = auth_headers(client, other_admin.email)

    response = client.get(
        "/api/v1/github/oauth/authorize",
        headers=headers,
        params={"type": "project", "project_id": str(project.id)},
    )
    assert response.status_code == 409


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.delete_webhook")
def test_disconnect_repository_rejects_non_linker(mock_delete, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="DLK")
    other_admin = add_project_member(db, org, workspace, project, "other-admin@test.dev", role="admin")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, webhook_hook_id=1234, connected_by=owner.id)

    other_headers = auth_headers(client, other_admin.email)
    denied = client.delete(f"/api/v1/github/repositories/{repo.id}", headers=other_headers)
    assert denied.status_code == 403
    mock_delete.assert_not_called()

    owner_headers = auth_headers(client, owner.email)
    allowed = client.delete(f"/api/v1/github/repositories/{repo.id}", headers=owner_headers)
    assert allowed.status_code == 200
    mock_delete.assert_called_once()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.delete_webhook")
def test_disconnect_repository(mock_delete, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, webhook_hook_id=1234, connected_by=owner.id)
    headers = auth_headers(client, owner.email)

    response = client.delete(f"/api/v1/github/repositories/{repo.id}", headers=headers)
    assert response.status_code == 200
    mock_delete.assert_called_once()
    listed = client.get(f"/api/v1/github/projects/{project.id}/repositories", headers=headers)
    assert listed.json() == []


@pytest.mark.integration
@patch("app.services.github_api_service.create_issue")
def test_create_task_auto_creates_github_issue(mock_issue, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="AUT")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    mock_issue.return_value = {"number": 101, "html_url": "https://github.com/acme/app/issues/101"}
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Auto issue task", "priority": "normal", "task_type": "task", "create_github_issue": True},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["github_issue_number"] == 101
    assert body["github_issue_url"] == "https://github.com/acme/app/issues/101"
    mock_issue.assert_called_once()
    assert mock_issue.call_args.kwargs["title"] == f"{project.name}/Auto issue task"


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_issue")
def test_create_github_issue_and_cache(mock_issue, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ISS")
    conn = seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Fix bug", number=8)
    mock_issue.return_value = {"number": 99, "html_url": "https://github.com/acme/app/issues/99"}
    headers = auth_headers(client, owner.email)

    created = client.post(f"/api/v1/github/tasks/{task.id}/create-issue", headers=headers)
    assert created.status_code == 201
    assert created.json()["issue_number"] == 99
    mock_issue.assert_called_once()
    assert mock_issue.call_args.kwargs["title"] == f"{project.name}/Fix bug"

    cached = client.post(f"/api/v1/github/tasks/{task.id}/create-issue", headers=headers)
    assert cached.status_code == 201
    mock_issue.assert_called_once()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_branch")
def test_create_task_branch_auto_name(mock_branch, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="BRH")
    conn = seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Feature", number=3)
    mock_branch.return_value = "https://github.com/acme/app/tree/iss-3-feature"
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/create-branch",
        headers=headers,
        json={"repository_id": str(repo.id)},
    )
    assert response.status_code == 201
    assert format_task_ref(project.id, 3).lower() in response.json()["branch"].lower()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.open_pull_request_for_branch")
def test_create_task_pr(mock_open_pr, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PRJ")
    conn = seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="PR task", number=4)
    mock_open_pr.return_value = {"number": 12, "html_url": "https://github.com/acme/app/pull/12"}
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/create-pr",
        headers=headers,
        json={"repository_id": str(repo.id), "head": "feature/x", "base": "main"},
    )
    assert response.status_code == 201
    assert response.json()["number"] == 12
    task_ref = format_task_ref(project.id, 4)
    mock_open_pr.assert_called_once()
    kwargs = mock_open_pr.call_args.kwargs
    assert kwargs["head"] == "feature/x"
    assert kwargs["base"] == "main"
    assert kwargs["commit_message"] == f"FlowDesk: {task_ref} — PR task"


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.search_code")
def test_connected_search(mock_search, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_project_github(db, org, project, owner, connected_search_enabled=True)
    mock_search.return_value = [
        {
            "name": "main.py",
            "path": "src/main.py",
            "html_url": "https://github.com/acme/app/blob/main/src/main.py",
            "repository": {"full_name": "acme/app"},
        }
    ]
    headers = auth_headers(client, owner.email)

    response = client.get(
        f"/api/v1/github/projects/{project.id}/search",
        headers=headers,
        params={"q": "def main"},
    )
    assert response.status_code == 200
    assert response.json()["connected"] is True
    assert response.json()["items"][0]["path"] == "src/main.py"


@pytest.mark.integration
def test_project_github_events_paginated(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="EVT")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, repo_id=88802)
    github_service.process_event(
        db,
        "push",
        "delivery-proj-1",
        {
            "repository": {"id": 88802, "html_url": "https://github.com/acme/evt"},
            "ref": "refs/heads/main",
            "commits": [{"message": "update"}],
            "sender": {"login": "dev1"},
        },
    )
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/github/projects/{project.id}/events", headers=headers)
    assert response.status_code == 200
    assert response.json()["total"] >= 1


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_branch")
def test_create_branch_falls_back_to_project_connection_without_personal(
    mock_branch, client, db, org, owner
):
    # No personal connection — a project-linked repo should still work, acting as
    # the project's connected GitHub account.
    workspace, project = build_project_stack(db, org, owner, project_key="PRC")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="No personal", number=1)
    mock_branch.return_value = "https://github.com/acme/app/tree/manual-branch"
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/create-branch",
        headers=headers,
        json={"repository_id": str(repo.id), "branch_name": "manual-branch"},
    )
    assert response.status_code == 201
    assert response.json()["branch"] == "manual-branch"
    mock_branch.assert_called_once()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_issue")
def test_create_issue_falls_back_to_project_connection_without_personal(
    mock_issue, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="PIC")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="No personal issue", number=2)
    mock_issue.return_value = {"number": 7, "html_url": "https://github.com/acme/app/issues/7"}
    headers = auth_headers(client, owner.email)

    response = client.post(f"/api/v1/github/tasks/{task.id}/create-issue", headers=headers)
    assert response.status_code == 201
    assert response.json()["issue_number"] == 7
    mock_issue.assert_called_once()


# ---------------------------------------------------------------------------
# Personal connection — browse own repos + act on them without a project link
# ---------------------------------------------------------------------------

@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.list_accessible_repos")
def test_list_personal_repos(mock_list, client, db, org, owner):
    seed_personal_github(db, org, owner)
    mock_list.return_value = [
        {"id": 1, "full_name": "dev-user/alpha", "default_branch": "main", "private": False},
        {"id": 2, "full_name": "dev-user/secret", "default_branch": "dev", "private": True},
    ]
    headers = auth_headers(client, owner.email)

    resp = client.get(f"/api/v1/github/organizations/{org.id}/personal-connection/repos", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert {r["repo_full_name"] for r in data} == {"dev-user/alpha", "dev-user/secret"}
    assert any(r["private"] for r in data)


@pytest.mark.integration
def test_list_personal_repos_requires_connection(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    resp = client.get(f"/api/v1/github/organizations/{org.id}/personal-connection/repos", headers=headers)
    assert resp.status_code == 412


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_branch")
@patch("app.api.v1.github.github_api_service.get_repo")
def test_create_branch_on_personal_repo_without_project_link(mock_get_repo, mock_branch, client, db, org, owner):
    # No project connection / linked repo — act purely on one of the caller's repos.
    workspace, project = build_project_stack(db, org, owner, project_key="PSR")
    seed_personal_github(db, org, owner)
    task = add_task(db, project, owner, title="Personal repo branch", number=2)
    mock_get_repo.return_value = {"id": 55, "default_branch": "main"}
    mock_branch.return_value = "https://github.com/dev-user/alpha/tree/psr-2"
    headers = auth_headers(client, owner.email)

    resp = client.post(
        f"/api/v1/github/tasks/{task.id}/create-branch",
        headers=headers,
        json={"repo_full_name": "dev-user/alpha"},
    )
    assert resp.status_code == 201
    assert format_task_ref(project.id, 2).lower() in resp.json()["branch"].lower()
    mock_get_repo.assert_called_once()
    mock_branch.assert_called_once()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.list_open_issues", return_value=[])
@patch("app.api.v1.github.github_api_service.create_webhook", return_value=99)
@patch("app.api.v1.github.github_api_service.create_issue")
@patch("app.api.v1.github.github_api_service.get_repo")
def test_create_issue_on_personal_repo_without_project_link(
    mock_get_repo, mock_issue, mock_webhook, mock_list_issues, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="PSI")
    seed_personal_github(db, org, owner)
    task = add_task(db, project, owner, title="Personal repo issue", number=3)
    mock_get_repo.return_value = {"id": 77, "default_branch": "main"}
    mock_issue.return_value = {"number": 5, "html_url": "https://github.com/dev-user/alpha/issues/5"}
    headers = auth_headers(client, owner.email)

    resp = client.post(
        f"/api/v1/github/tasks/{task.id}/create-issue",
        headers=headers,
        json={"repo_full_name": "dev-user/alpha"},
    )
    assert resp.status_code == 201
    assert resp.json()["issue_number"] == 5
    mock_get_repo.assert_called_once()
    linked = db.scalar(
        select(GithubRepository).where(
            GithubRepository.project_id == project.id,
            GithubRepository.repo_full_name == "dev-user/alpha",
        )
    )
    assert linked is not None


@pytest.mark.integration
@patch("app.services.github_api_service.update_issue_state")
def test_reopen_task_github_issue_endpoint(mock_reopen, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    todo = CustomStatus(project_id=project.id, name="To Do", color="#ccc", category="todo", position=0)
    done = CustomStatus(project_id=project.id, name="Complete", color="#0f0", category="done", position=1)
    db.add_all([todo, done])
    task = add_task(db, project, owner, title="Done task", number=1)
    task.github_issue_number = 3
    task.status_id = done.id
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    db.commit()
    headers = auth_headers(client, owner.email)

    resp = client.post(f"/api/v1/github/tasks/{task.id}/reopen-issue", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["updated"] is True
    assert task.status_id == todo.id
    mock_reopen.assert_called_once()


@pytest.mark.integration
@patch("app.services.github_service.sync_task_issue_status_from_github", return_value=True)
def test_sync_task_github_issue_status_endpoint(mock_sync, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Linked", number=1)
    task.github_issue_number = 3
    db.commit()
    headers = auth_headers(client, owner.email)

    resp = client.post(f"/api/v1/github/tasks/{task.id}/sync-issue-status", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["updated"] is True
    mock_sync.assert_called_once()


@pytest.mark.integration
@patch("app.services.github_api_service.list_open_issues", return_value=[])
@patch("app.services.github_service.sync_project_issues", return_value=(2, 0))
def test_sync_project_github_issues_endpoint(mock_sync, mock_list, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    resp = client.post(f"/api/v1/github/projects/{project.id}/sync-issues", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["imported"] == 2
    mock_sync.assert_called_once()


@pytest.mark.integration
@patch("app.services.github_api_service.create_issue_comment")
@patch("app.services.github_api_service.list_open_issues")
def test_sync_issues_endpoint_imports_open_issues(mock_list, mock_comment, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="SyncProj")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, repo_id=5555)
    mock_list.return_value = [
        {
            "number": 9,
            "title": "Synced issue",
            "body": "from github",
            "html_url": "https://github.com/acme/app/issues/9",
            "user": {"login": "dev-user"},
        }
    ]
    headers = auth_headers(client, owner.email)

    resp = client.post(f"/api/v1/github/projects/{project.id}/sync-issues", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["imported"] == 1

    from app.models.task import Task

    task = db.scalar(select(Task).where(Task.project_id == project.id, Task.github_issue_number == 9))
    assert task is not None
    assert task.title == "Synced issue"


@pytest.mark.integration
def test_create_branch_without_any_repo_returns_400(client, db, org, owner):
    # Personal connection present, but no repo chosen and none linked to the project.
    workspace, project = build_project_stack(db, org, owner, project_key="NON")
    seed_personal_github(db, org, owner)
    task = add_task(db, project, owner, title="No repo at all", number=4)
    headers = auth_headers(client, owner.email)

    resp = client.post(f"/api/v1/github/tasks/{task.id}/create-branch", headers=headers, json={})
    assert resp.status_code == 400


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues", return_value=[])
def test_connect_personal_repo_to_project(mock_list_issues, mock_get_repo, mock_webhook, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="LNK", project_name="Linker")
    seed_personal_github(db, org, owner)
    mock_get_repo.return_value = {"id": 999, "default_branch": "main"}
    mock_webhook.return_value = 4242
    headers = auth_headers(client, owner.email)

    resp = client.post(
        f"/api/v1/github/organizations/{org.id}/personal-connection/connect-repo",
        headers=headers,
        json={"project_id": str(project.id), "repo_full_name": "dev-user/alpha"},
    )
    assert resp.status_code == 201
    assert resp.json()["repo_full_name"] == "dev-user/alpha"
    assert resp.json()["project_id"] == str(project.id)
    mock_webhook.assert_called_once()

    # Shows up as a personal link with the project name resolved
    links = client.get(f"/api/v1/github/organizations/{org.id}/personal-connection/links", headers=headers)
    assert links.status_code == 200
    assert any(
        link["repo_full_name"] == "dev-user/alpha" and link["project_name"] == "Linker"
        for link in links.json()
    )

    # And becomes a repo on the project (shared activity-sync target)
    proj_repos = client.get(f"/api/v1/github/projects/{project.id}/repositories", headers=headers)
    assert any(r["repo_full_name"] == "dev-user/alpha" for r in proj_repos.json())


@pytest.mark.integration
def test_connect_personal_repo_requires_connection(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="NPC")
    headers = auth_headers(client, owner.email)

    resp = client.post(
        f"/api/v1/github/organizations/{org.id}/personal-connection/connect-repo",
        headers=headers,
        json={"project_id": str(project.id), "repo_full_name": "dev-user/alpha"},
    )
    assert resp.status_code == 412


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues", return_value=[])
def test_connect_personal_repo_duplicate_returns_409(mock_list_issues, mock_get_repo, mock_webhook, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="DUP")
    seed_personal_github(db, org, owner)
    mock_get_repo.return_value = {"id": 1, "default_branch": "main"}
    mock_webhook.return_value = 7
    headers = auth_headers(client, owner.email)
    url = f"/api/v1/github/organizations/{org.id}/personal-connection/connect-repo"
    payload = {"project_id": str(project.id), "repo_full_name": "dev-user/alpha"}

    assert client.post(url, headers=headers, json=payload).status_code == 201
    assert client.post(url, headers=headers, json=payload).status_code == 409

    second_repo = {"project_id": str(project.id), "repo_full_name": "dev-user/beta"}
    assert client.post(url, headers=headers, json=second_repo).status_code == 409


@pytest.mark.integration
@patch("app.services.github_api_service.revoke_authorization")
def test_disconnect_revokes_github_authorization(mock_revoke_grant, client, db, org, owner, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "csecret")
    seed_personal_github(db, org, owner)
    headers = auth_headers(client, owner.email)

    resp = client.delete(f"/api/v1/github/organizations/{org.id}/personal-connection", headers=headers)
    assert resp.status_code == 200
    # Grant is fully revoked so the next connect re-shows the consent screen
    mock_revoke_grant.assert_called_once()


@pytest.mark.integration
@patch("app.services.github_api_service.revoke_authorization")
def test_disconnect_skips_revoke_without_oauth_creds(mock_revoke_grant, client, db, org, owner, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "")
    seed_personal_github(db, org, owner)
    headers = auth_headers(client, owner.email)

    resp = client.delete(f"/api/v1/github/organizations/{org.id}/personal-connection", headers=headers)
    assert resp.status_code == 200
    mock_revoke_grant.assert_not_called()


@pytest.mark.integration
@patch("app.services.github_api_service.create_issue_comment")
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues")
def test_link_backfills_open_issues_as_tasks(
    mock_list_issues, mock_get_repo, mock_webhook, mock_comment, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="BAK", project_name="Backfill")
    seed_personal_github(db, org, owner)
    mock_get_repo.return_value = {"id": 321, "default_branch": "main"}
    mock_webhook.return_value = 11
    mock_list_issues.return_value = [
        {"number": 1, "title": "First bug", "body": "desc",
         "html_url": "https://github.com/dev-user/alpha/issues/1", "user": {"login": "dev-user"}},
        {"number": 2, "title": "Second", "body": "",
         "html_url": "https://github.com/dev-user/alpha/issues/2", "user": {"login": "dev-user"}},
        {"number": 3, "title": "A PR, not an issue", "pull_request": {"url": "x"},
         "html_url": "https://github.com/dev-user/alpha/pull/3", "user": {"login": "dev-user"}},
    ]
    headers = auth_headers(client, owner.email)

    resp = client.post(
        f"/api/v1/github/organizations/{org.id}/personal-connection/connect-repo",
        headers=headers,
        json={"project_id": str(project.id), "repo_full_name": "dev-user/alpha"},
    )
    assert resp.status_code == 201

    # The two real issues are imported as tasks (the PR is skipped)
    from app.models.task import Task
    imported = db.scalars(
        select(Task).where(Task.project_id == project.id, Task.github_issue_number.isnot(None))
    ).all()
    assert {t.github_issue_number for t in imported} == {1, 2}
    assert {t.title for t in imported} == {"First bug", "Second"}

    # And they surface in the project's GitHub activity tab
    events = client.get(f"/api/v1/github/projects/{project.id}/events", headers=headers)
    assert events.status_code == 200
    assert events.json()["total"] == 2

    # Each imported issue gets a "View in FlowDesk" back-link comment on GitHub
    assert mock_comment.call_count == 2
    assert "View in FlowDesk" in mock_comment.call_args.args[-1]


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.list_accessible_repos")
def test_available_repos_excludes_repos_linked_to_other_projects(mock_list, client, db, org, owner):
    ws_a, project_a = build_project_stack(db, org, owner, project_name="Alpha")
    ws_b, project_b = build_project_stack(db, org, owner, project_name="Beta")
    conn_a = seed_project_github(db, org, project_a, owner)
    seed_project_github(db, org, project_b, owner)
    seed_github_repo(db, ws_a, project_a, conn_a, repo_full_name="acme/shared", repo_id=70001)
    mock_list.return_value = [
        {"id": 70001, "full_name": "acme/shared", "default_branch": "main", "private": False},
        {"id": 70002, "full_name": "acme/free", "default_branch": "main", "private": False},
    ]
    headers = auth_headers(client, owner.email)

    response = client.get(
        f"/api/v1/github/projects/{project_b.id}/available-repos",
        headers=headers,
    )
    assert response.status_code == 200
    names = {r["repo_full_name"] for r in response.json()}
    assert names == {"acme/free"}


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
def test_connect_repo_rejects_repo_linked_to_another_project(mock_get_repo, mock_hook, client, db, org, owner):
    ws_a, project_a = build_project_stack(db, org, owner, project_name="Alpha")
    ws_b, project_b = build_project_stack(db, org, owner, project_name="Beta")
    conn_a = seed_project_github(db, org, project_a, owner)
    seed_project_github(db, org, project_b, owner)
    seed_github_repo(db, ws_a, project_a, conn_a, repo_full_name="acme/taken", repo_id=71001)
    mock_get_repo.return_value = {"id": 71001, "default_branch": "main"}
    mock_hook.return_value = 71002
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/projects/{project_b.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/taken"},
    )
    assert response.status_code == 409
    assert "Alpha" in response.json()["detail"]


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
def test_connect_personal_repo_rejects_repo_linked_to_another_project(
    mock_get_repo, mock_hook, client, db, org, owner
):
    ws_a, project_a = build_project_stack(db, org, owner, project_name="Alpha")
    _, project_b = build_project_stack(db, org, owner, project_name="Beta")
    conn_personal = seed_personal_github(db, org, owner)
    seed_github_repo(
        db, ws_a, project_a, conn_personal, repo_full_name="dev-user/taken", repo_id=72001
    )
    mock_get_repo.return_value = {"id": 72001, "default_branch": "main"}
    mock_hook.return_value = 72002
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/organizations/{org.id}/personal-connection/connect-repo",
        headers=headers,
        json={"project_id": str(project_b.id), "repo_full_name": "dev-user/taken"},
    )
    assert response.status_code == 409
    assert "Alpha" in response.json()["detail"]
