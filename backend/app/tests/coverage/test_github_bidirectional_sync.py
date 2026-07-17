"""Bidirectional GitHub ↔ FlowDesk sync — each feature tested in both directions."""
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.core.task_ref import format_task_ref
from app.services.github_issue_body import format_github_issue_body
from app.models.github import GithubRepository
from app.models.task import CustomStatus, Task
from app.services import github_service
from app.services.github_api_service import FLOWDESK_LABEL_PREFIX, GitHubApiError, GitHubPathValidationError
from app.tests.conftest import auth_headers
from app.tests.helpers import (
    add_task,
    build_project_stack,
    seed_github_repo,
    seed_personal_github,
    seed_project_github,
)


# ---------------------------------------------------------------------------
# Issue creation — FlowDesk → GitHub and GitHub → FlowDesk
# ---------------------------------------------------------------------------


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue")
def test_flowdesk_create_task_auto_creates_github_issue(mock_create, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="FD2GH")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    mock_create.return_value = {"number": 201, "html_url": "https://github.com/acme/app/issues/201"}
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Bidirectional task", "priority": "normal", "task_type": "task", "create_github_issue": True},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["github_issue_number"] == 201
    mock_create.assert_called_once()


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue")
def test_flowdesk_create_task_skips_github_issue_when_toggle_off(mock_create, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="FDNOGH")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Local only task", "priority": "normal", "task_type": "task"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["github_issue_number"] is None
    mock_create.assert_not_called()


@pytest.mark.coverage
def test_github_issue_opened_creates_flowdesk_task(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GH2FD")
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88001,
        repo_full_name="acme/bidir",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "opened",
        "repository": {"id": 88001, "html_url": "https://github.com/acme/bidir"},
        "issue": {
            "number": 15,
            "title": "From GitHub only",
            "body": "Inbound body",
            "html_url": "https://github.com/acme/bidir/issues/15",
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "issues", "bidir-open-1", payload)
    assert stored == 1
    from sqlalchemy import select

    task = db.scalar(select(Task).where(Task.project_id == project.id, Task.title == "From GitHub only"))
    assert task is not None
    assert task.github_issue_number == 15


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue")
def test_flowdesk_create_task_without_repo_skips_github_issue(mock_create, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="NORP")
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "No repo task", "priority": "normal", "task_type": "task"},
    )
    assert response.status_code == 201
    assert response.json()["github_issue_number"] is None
    mock_create.assert_not_called()


# ---------------------------------------------------------------------------
# Description — both directions
# ---------------------------------------------------------------------------


@pytest.mark.coverage
@patch("app.api.v1.tasks.github_api_service.patch_issue")
def test_flowdesk_description_update_syncs_to_github(mock_patch, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="FDSC")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Desc sync", number=1)
    task.github_issue_number = 31
    task.description = "old"
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"description": "FlowDesk wrote this"},
    )
    assert response.status_code == 200
    mock_patch.assert_called_once()
    task_ref = format_task_ref(project.id, task.number)
    expected_body = format_github_issue_body(
        task_ref=task_ref,
        title=task.title,
        description="FlowDesk wrote this",
        task_id=task.id,
    )
    assert mock_patch.call_args.kwargs["body"] == expected_body


@pytest.mark.coverage
def test_github_description_edit_syncs_to_flowdesk(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="SyncProj")
    task = add_task(db, project, owner, title="Desc task", number=2)
    task.description = "Before"
    task.github_issue_number = 32
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88002,
        repo_full_name="acme/desc",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "edited",
        "repository": {"id": 88002, "html_url": "https://github.com/acme/desc"},
        "issue": {
            "number": 32,
            "title": "SyncProj/Desc task",
            "body": "GitHub wrote this",
            "html_url": "https://github.com/acme/desc/issues/32",
        },
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "issues", "bidir-desc-1", payload)
    assert task.description == "GitHub wrote this"


# ---------------------------------------------------------------------------
# Title — both directions
# ---------------------------------------------------------------------------


@pytest.mark.coverage
@patch("app.api.v1.tasks.github_api_service.patch_issue")
def test_flowdesk_title_update_syncs_to_github(mock_patch, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="FDTL")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Old title", number=3)
    task.github_issue_number = 33
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"title": "New title"},
    )
    assert response.status_code == 200
    mock_patch.assert_called_once()
    assert mock_patch.call_args.kwargs["title"] == f"{project.name}/New title"


@pytest.mark.coverage
def test_github_title_edit_syncs_to_flowdesk(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="TitleProj")
    task = add_task(db, project, owner, title="Old", number=4)
    task.github_issue_number = 34
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88003,
        repo_full_name="acme/title",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "edited",
        "repository": {"id": 88003, "html_url": "https://github.com/acme/title"},
        "issue": {
            "number": 34,
            "title": "TitleProj/Renamed on GitHub",
            "body": "",
            "html_url": "https://github.com/acme/title/issues/34",
        },
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "issues", "bidir-title-1", payload)
    assert task.title == "Renamed on GitHub"


# ---------------------------------------------------------------------------
# Status — both directions
# ---------------------------------------------------------------------------


@pytest.mark.coverage
@patch("app.services.github_api_service.add_issue_labels")
@patch("app.services.github_api_service.ensure_label")
@patch("app.services.github_api_service.update_issue_state")
def test_flowdesk_status_done_closes_github_issue(mock_state, _mock_label, _mock_add, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="FDST")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(done)
    task = add_task(db, project, owner, title="Status sync", number=5)
    task.github_issue_number = 35
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"status_id": str(done.id)},
    )
    assert response.status_code == 200
    mock_state.assert_called_once()
    assert mock_state.call_args.args[-1] == "closed"


@pytest.mark.coverage
def test_github_issue_closed_moves_task_to_done(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GHST")
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=1)
    db.add(done)
    task = add_task(db, project, owner, title="Close sync", number=6)
    task.github_issue_number = 36
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88004,
        repo_full_name="acme/status",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "closed",
        "repository": {"id": 88004, "html_url": "https://github.com/acme/status"},
        "issue": {"number": 36, "title": "Close sync", "html_url": "https://github.com/acme/status/issues/36"},
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "issues", "bidir-close-1", payload)
    assert task.status_id == done.id


@pytest.mark.coverage
@patch("app.services.github_api_service.add_issue_labels")
@patch("app.services.github_api_service.list_issue_labels", return_value=[])
@patch("app.services.github_api_service.ensure_label")
@patch("app.services.github_api_service.update_issue_state")
def test_flowdesk_intermediate_status_keeps_github_issue_open(
    mock_state, _mock_ensure, _mock_list, _mock_add, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="FDIN")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    in_progress = CustomStatus(
        project_id=project.id, name="In Progress", color="#00f", category="in_progress", position=0
    )
    db.add(in_progress)
    task = add_task(db, project, owner, title="Progress sync", number=7)
    task.github_issue_number = 37
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"status_id": str(in_progress.id)},
    )
    assert response.status_code == 200
    assert mock_state.call_args.args[-1] == "open"


@pytest.mark.coverage
def test_github_issue_labeled_moves_task_to_matching_status(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GHLB")
    in_review = CustomStatus(
        project_id=project.id, name="In Review", color="#fa0", category="in_progress", position=0
    )
    db.add(in_review)
    task = add_task(db, project, owner, title="Label sync", number=8)
    task.github_issue_number = 38
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88005,
        repo_full_name="acme/label-sync",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "labeled",
        "repository": {"id": 88005, "html_url": "https://github.com/acme/label-sync"},
        "issue": {"number": 38, "title": "Label sync", "html_url": "https://github.com/acme/label-sync/issues/38"},
        "label": {"name": f"{FLOWDESK_LABEL_PREFIX}In Review"},
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "issues", "bidir-label-1", payload)
    assert task.status_id == in_review.id


# ---------------------------------------------------------------------------
# Pull request — GitHub → FlowDesk (open + merge)
# ---------------------------------------------------------------------------


@pytest.mark.coverage
def test_github_pr_opened_moves_task_to_in_review(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GPRO")
    review = CustomStatus(
        project_id=project.id, name="In Review", color="#00f", category="in_progress", position=0
    )
    db.add(review)
    task = add_task(db, project, owner, title="PR task", number=9)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88006,
        repo_full_name="acme/pr-sync",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    task_ref = format_task_ref(project.id, 9)

    payload = {
        "action": "opened",
        "repository": {"id": 88006, "html_url": "https://github.com/acme/pr-sync"},
        "pull_request": {
            "number": 50,
            "title": f"{task_ref} feature",
            "body": "",
            "html_url": "https://github.com/acme/pr-sync/pull/50",
            "merged": False,
        },
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "pull_request", "bidir-pr-open-1", payload)
    assert task.status_id == review.id


@pytest.mark.coverage
def test_github_pr_merged_moves_task_to_done(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GPRM")
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(done)
    task = add_task(db, project, owner, title="Merge task", number=10)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88007,
        repo_full_name="acme/pr-merge",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    task_ref = format_task_ref(project.id, 10)

    payload = {
        "action": "closed",
        "repository": {"id": 88007, "html_url": "https://github.com/acme/pr-merge"},
        "pull_request": {
            "number": 51,
            "title": f"{task_ref} ship it",
            "body": "",
            "html_url": "https://github.com/acme/pr-merge/pull/51",
            "merged": True,
        },
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "pull_request", "bidir-pr-merge-1", payload)
    assert task.status_id == done.id


# ---------------------------------------------------------------------------
# ensure_task_github_issue — edge cases (service unit)
# ---------------------------------------------------------------------------


@pytest.mark.coverage
def test_ensure_task_github_issue_skips_when_already_linked(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Linked", number=11)
    task.github_issue_number = 99
    db.flush()

    with patch("app.services.github_api_service.create_issue") as mock_create:
        github_service.ensure_task_github_issue(db, task, project)
        mock_create.assert_not_called()


@pytest.mark.coverage
def test_ensure_task_github_issue_skips_without_repo(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Lonely", number=12)

    with patch("app.services.github_api_service.create_issue") as mock_create:
        github_service.ensure_task_github_issue(db, task, project)
        mock_create.assert_not_called()


@pytest.mark.coverage
def test_ensure_task_github_issue_skips_without_token(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner, token="")
    repo = seed_github_repo(db, workspace, project, conn)
    repo.connection_id = conn.id
    task = add_task(db, project, owner, title="No token", number=13)

    with patch("app.services.github_api_service.create_issue") as mock_create:
        github_service.ensure_task_github_issue(db, task, project)
        mock_create.assert_not_called()


@pytest.mark.coverage
def test_ensure_task_github_issue_skips_invalid_repo_path(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, repo_full_name="bad name with spaces")
    repo.connection_id = conn.id
    task = add_task(db, project, owner, title="Bad repo", number=14)

    with patch("app.services.github_api_service.create_issue") as mock_create:
        with patch(
            "app.services.github_api_service.parse_repo_full_name",
            side_effect=GitHubPathValidationError("invalid"),
        ):
            github_service.ensure_task_github_issue(db, task, project)
        mock_create.assert_not_called()


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue", side_effect=RuntimeError("gh down"))
def test_ensure_task_github_issue_swallows_create_errors(_mock_create, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Fail create", number=15)

    github_service.ensure_task_github_issue(db, task, project)
    assert task.github_issue_number is None


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue")
def test_ensure_task_github_issue_success_sets_fields(mock_create, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="EnsureProj")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Auto", number=16)
    mock_create.return_value = {"number": 77, "html_url": "https://github.com/acme/app/issues/77"}

    github_service.ensure_task_github_issue(db, task, project)
    assert task.github_issue_number == 77
    assert task.github_issue_url == "https://github.com/acme/app/issues/77"
    mock_create.assert_called_once()
    assert mock_create.call_args.kwargs["title"] == "EnsureProj/Auto"


# ---------------------------------------------------------------------------
# Backfill / fetch helpers
# ---------------------------------------------------------------------------


@pytest.mark.coverage
@patch("app.services.github_api_service.list_open_issues")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_fetch_open_issues_non_401_error_returns_none(mock_reveal, mock_list, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    mock_list.side_effect = GitHubApiError(403, "forbidden")

    issues = github_service._fetch_open_issues_for_repo(db, repo)
    assert issues is None
    mock_reveal.assert_called()


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue_comment")
@patch("app.services.github_api_service.list_open_issues")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_backfill_skips_pull_request_entries(mock_reveal, mock_list, mock_comment, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="Backfill")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    mock_list.return_value = [
        {
            "number": 1,
            "title": "Backfill/Real issue",
            "body": "ok",
            "html_url": "https://github.com/acme/app/issues/1",
            "user": {"login": "dev"},
        },
        {
            "number": 2,
            "title": "PR disguised as issue",
            "html_url": "https://github.com/acme/app/pull/2",
            "pull_request": {"url": "https://api.github.com/repos/acme/app/pulls/2"},
        },
    ]

    created = github_service.backfill_open_issues(db, repo)
    assert created == 1
    mock_comment.assert_called_once()


@pytest.mark.coverage
def test_process_event_ignores_duplicate_delivery(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88008,
        repo_full_name="acme/dup",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "opened",
        "repository": {"id": 88008, "html_url": "https://github.com/acme/dup"},
        "issue": {
            "number": 1,
            "title": "Once",
            "body": "",
            "html_url": "https://github.com/acme/dup/issues/1",
        },
        "sender": {"login": "dev1"},
    }
    first = github_service.process_event(db, "issues", "dup-delivery-1", payload)
    second = github_service.process_event(db, "issues", "dup-delivery-1", payload)
    assert first == 1
    assert second == 0


@pytest.mark.coverage
def test_github_issue_closed_moves_task_to_completed_status(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CMP")
    completed = CustomStatus(
        project_id=project.id, name="Completed", color="#0f0", category="done", position=0
    )
    db.add(completed)
    task = add_task(db, project, owner, title="Complete me", number=20)
    task.github_issue_number = 120
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88110,
        repo_full_name="acme/complete",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "closed",
        "repository": {"id": 88110, "html_url": "https://github.com/acme/complete"},
        "issue": {"number": 120, "title": "Complete me", "html_url": "https://github.com/acme/complete/issues/120"},
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "issues", "complete-close-1", payload)
    assert task.status_id == completed.id


@pytest.mark.coverage
def test_github_sub_issue_added_creates_subtask(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SUB")
    parent = add_task(db, project, owner, title="Parent task", number=21)
    parent.github_issue_number = 50
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88111,
        repo_full_name="acme/sub",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "sub_issue_added",
        "repository": {"id": 88111, "html_url": "https://github.com/acme/sub"},
        "parent_issue": {"number": 50, "title": "Parent task", "html_url": "https://github.com/acme/sub/issues/50"},
        "sub_issue": {
            "number": 51,
            "title": "Child from GitHub",
            "body": "Sub-issue body",
            "html_url": "https://github.com/acme/sub/issues/51",
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "sub_issues", "sub-add-1", payload)
    assert stored == 1
    from sqlalchemy import select

    child = db.scalar(
        select(Task).where(Task.project_id == project.id, Task.parent_task_id == parent.id)
    )
    assert child is not None
    assert child.title == "Child from GitHub"
    assert child.github_issue_number == 51


@pytest.mark.coverage
@patch("app.services.github_api_service.add_sub_issue")
@patch("app.services.github_api_service.create_issue")
def test_subtask_under_linked_parent_auto_creates_github_sub_issue(
    mock_create, mock_link, client, db, org, owner
):
    """Subtasks inherit GitHub sync when the parent already has a linked issue."""
    workspace, project = build_project_stack(db, org, owner, project_key="SUB3")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    parent = add_task(db, project, owner, title="Parent", number=31)
    parent.github_issue_number = 70
    db.flush()
    mock_create.return_value = {
        "number": 71,
        "id": 900071,
        "html_url": "https://github.com/acme/sub3/issues/71",
    }
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Auto subtask", "parent_task_id": str(parent.id)},
    )
    assert response.status_code == 201, response.text
    assert response.json()["github_issue_number"] == 71
    mock_create.assert_called_once()
    mock_link.assert_called_once()


@pytest.mark.coverage
@patch("app.services.github_api_service.add_sub_issue")
@patch("app.services.github_api_service.create_issue")
def test_flowdesk_subtask_create_links_github_sub_issue(mock_create, mock_link, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SUB2")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    parent = add_task(db, project, owner, title="Parent", number=30)
    parent.github_issue_number = 60
    db.flush()
    mock_create.return_value = {
        "number": 61,
        "id": 900061,
        "html_url": "https://github.com/acme/sub2/issues/61",
    }
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Child subtask", "parent_task_id": str(parent.id), "create_github_issue": True},
    )
    assert response.status_code == 201
    mock_create.assert_called_once()
    mock_link.assert_called_once_with(
        mock_create.call_args.args[0],
        mock_create.call_args.args[1],
        mock_create.call_args.args[2],
        60,
        900061,
    )


@pytest.mark.coverage
def test_github_issue_body_roundtrip():
    body = format_github_issue_body(
        task_ref="ABCD1234-1",
        title="My task",
        description="User notes here",
        task_id="00000000-0000-0000-0000-000000000001",
    )
    assert "User notes here" in body
    from app.services.github_issue_body import parse_github_issue_description

    assert parse_github_issue_description(body) == "User notes here"


@pytest.mark.coverage
@patch("app.services.github_api_service.get_issue")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_task_issue_status_moves_to_complete_when_closed_on_github(
    mock_reveal, mock_get_issue, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="POLL")
    completed = CustomStatus(
        project_id=project.id, name="Complete", color="#0f0", category="done", position=0
    )
    todo = CustomStatus(project_id=project.id, name="To Do", color="#ccc", category="todo", position=1)
    db.add_all([completed, todo])
    task = add_task(db, project, owner, title="Poll close", number=30)
    task.github_issue_number = 200
    task.status_id = todo.id
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, repo_id=88200)
    mock_get_issue.return_value = {"number": 200, "state": "closed"}
    db.flush()

    updated = github_service.sync_task_issue_status_from_github(db, task)
    assert updated is True
    assert task.status_id == completed.id


@pytest.mark.coverage
@patch("app.services.github_api_service.get_issue")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_task_issue_status_reopens_when_issue_open_on_github(
    mock_reveal, mock_get_issue, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="POLL2")
    completed = CustomStatus(
        project_id=project.id, name="Complete", color="#0f0", category="done", position=0
    )
    todo = CustomStatus(project_id=project.id, name="To Do", color="#ccc", category="todo", position=1)
    db.add_all([completed, todo])
    task = add_task(db, project, owner, title="Poll reopen", number=31)
    task.github_issue_number = 201
    task.status_id = completed.id
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, repo_id=88201)
    mock_get_issue.return_value = {"number": 201, "state": "open"}
    db.flush()

    updated = github_service.sync_task_issue_status_from_github(db, task)
    assert updated is True
    assert task.status_id == todo.id


# ---------------------------------------------------------------------------
# Comment sync — FlowDesk ↔ GitHub
# ---------------------------------------------------------------------------


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue_comment")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_flowdesk_comment_syncs_to_github(mock_reveal, mock_comment, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CMT1")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Comment sync", number=40)
    task.github_issue_number = 501
    db.flush()
    mock_comment.return_value = {"id": 9001}
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/issue-comment",
        headers=headers,
        json={"body": "Hello from FlowDesk"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["github_comment_id"] == 9001
    mock_comment.assert_called_once()
    assert "Hello from FlowDesk" in mock_comment.call_args.args[4]
    assert github_service.FLOWDESK_COMMENT_MARKER in mock_comment.call_args.args[4]


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue_comment")
def test_activity_comment_stays_local_only(mock_comment, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="LOC1")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Local comment", number=44)
    task.github_issue_number = 505
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=headers,
        json={"body": "Activity only"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["github_comment_id"] is None
    mock_comment.assert_not_called()

    listed = client.get(
        f"/api/v1/tasks/{task.id}/comments?scope=local",
        headers=headers,
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    github_list = client.get(
        f"/api/v1/tasks/{task.id}/comments?scope=github",
        headers=headers,
    )
    assert github_list.json()["total"] == 0


@pytest.mark.coverage
def test_github_issue_comment_imports_to_flowdesk(db, org, owner):
    from app.models.comment import Comment

    workspace, project = build_project_stack(db, org, owner, project_key="CMT2")
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88050,
        repo_full_name="acme/comments",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    task = add_task(db, project, owner, title="Linked", number=41)
    task.github_issue_number = 502
    db.flush()

    payload = {
        "action": "created",
        "repository": {"id": 88050, "html_url": "https://github.com/acme/comments"},
        "issue": {"number": 502, "html_url": "https://github.com/acme/comments/issues/502"},
        "comment": {
            "id": 9100,
            "body": "Review looks good",
            "html_url": "https://github.com/acme/comments/issues/502#issuecomment-9100",
            "user": {"login": "reviewer"},
        },
        "sender": {"login": "reviewer"},
    }
    stored = github_service.process_event(db, "issue_comment", "cmt-delivery-1", payload)
    assert stored == 1
    comment = db.scalar(select(Comment).where(Comment.github_comment_id == 9100))
    assert comment is not None
    assert comment.body == "Review looks good"
    assert comment.github_author_login == "reviewer"


@pytest.mark.coverage
def test_github_issue_comment_skips_flowdesk_origin_marker(db, org, owner):
    from app.models.comment import Comment

    workspace, project = build_project_stack(db, org, owner, project_key="CMT3")
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88051,
        repo_full_name="acme/loop",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    task = add_task(db, project, owner, title="Loop", number=42)
    task.github_issue_number = 503
    db.flush()

    payload = {
        "action": "created",
        "repository": {"id": 88051, "html_url": "https://github.com/acme/loop"},
        "issue": {"number": 503, "html_url": "https://github.com/acme/loop/issues/503"},
        "comment": {
            "id": 9101,
            "body": f"**Owner (FlowDesk):**\n\nsynced\n\n{github_service.FLOWDESK_COMMENT_MARKER}",
            "user": {"login": "owner"},
        },
        "sender": {"login": "owner"},
    }
    github_service.process_event(db, "issue_comment", "cmt-delivery-2", payload)
    assert db.scalar(select(Comment).where(Comment.github_comment_id == 9101)) is None


@pytest.mark.coverage
@patch("app.services.github_api_service.list_issue_comments")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_issue_comments_imports_from_github(mock_reveal, mock_list, db, org, owner):
    from app.models.comment import Comment

    workspace, project = build_project_stack(db, org, owner, project_key="CMT4")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, repo_id=88052)
    task = add_task(db, project, owner, title="Pull comments", number=43)
    task.github_issue_number = 504
    db.flush()
    mock_list.return_value = [
        {
            "id": 9200,
            "body": "From GitHub directly",
            "user": {"login": "external"},
        },
    ]

    imported = github_service.sync_issue_comments_for_task(db, repo, task)
    assert imported == 1
    comment = db.scalar(select(Comment).where(Comment.github_comment_id == 9200))
    assert comment is not None
    assert comment.body == "From GitHub directly"


# ---------------------------------------------------------------------------
# API routes — sync endpoints and validation
# ---------------------------------------------------------------------------


@pytest.mark.coverage
def test_sync_sub_issues_returns_zero_without_linked_issue(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SUB0")
    task = add_task(db, project, owner, title="No issue", number=50)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/sync-sub-issues",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 0


@pytest.mark.coverage
def test_sync_sub_issues_returns_zero_for_subtask(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SUB1")
    parent = add_task(db, project, owner, title="Parent", number=51)
    parent.github_issue_number = 600
    child = add_task(db, project, owner, title="Child", number=52)
    child.parent_task_id = parent.id
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{child.id}/sync-sub-issues",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 0


@pytest.mark.coverage
def test_sync_issue_comments_returns_zero_without_linked_issue(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CMT5")
    task = add_task(db, project, owner, title="No GH issue", number=55)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/sync-issue-comments",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 0


@pytest.mark.coverage
def test_issue_comment_rejects_task_without_github_issue(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CMT6")
    task = add_task(db, project, owner, title="Unlinked", number=56)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/issue-comment",
        headers=headers,
        json={"body": "Should fail"},
    )
    assert response.status_code == 400
    assert "linked github issue" in response.json()["detail"].lower()


@pytest.mark.coverage
@patch("app.services.github_api_service.list_issue_comments")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_issue_comments_via_api(mock_reveal, mock_list, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CMT7")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, repo_id=88053)
    task = add_task(db, project, owner, title="Pull via API", number=57)
    task.github_issue_number = 505
    db.flush()
    mock_list.return_value = [
        {"id": 9300, "body": "API pull", "user": {"login": "dev"}},
    ]
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/sync-issue-comments",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 1


@pytest.mark.coverage
@patch("app.services.github_api_service.list_sub_issues")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_sub_issues_via_api_imports(mock_reveal, mock_list, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SUB2")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, repo_id=88054)
    parent = add_task(db, project, owner, title="Parent task", number=58)
    parent.github_issue_number = 800
    parent_ref = format_task_ref(project.id, 58)
    mock_list.return_value = [
        {
            "number": 801,
            "title": f"{parent_ref}/Sub from GitHub",
            "body": "sub body",
            "html_url": "https://github.com/acme/app/issues/801",
            "state": "open",
        },
    ]
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{parent.id}/sync-sub-issues",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 1
    subtask = db.scalar(select(Task).where(Task.github_issue_number == 801))
    assert subtask is not None
    assert subtask.parent_task_id == parent.id


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue_comment", return_value={"id": 9400})
@patch("app.services.github_api_service.sync_issue_status")
@patch("app.services.github_api_service.update_issue_state")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_close_task_github_issue_via_api(mock_reveal, mock_state, mock_sync, mock_comment, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLS1")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    done = CustomStatus(project_id=project.id, name="Complete", color="#0f0", category="done", position=0)
    todo = CustomStatus(project_id=project.id, name="To Do", color="#ccc", category="todo", position=1)
    db.add_all([done, todo])
    task = add_task(db, project, owner, title="Close me", number=59)
    task.github_issue_number = 510
    task.status_id = todo.id
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/close-issue",
        headers=headers,
        json={"body": "Closing from FlowDesk"},
    )
    assert response.status_code == 200, response.text
    mock_state.assert_called_once()
    assert task.status_id == done.id


@pytest.mark.coverage
def test_sync_sub_issues_returns_zero_without_linked_repo(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SUB3")
    task = add_task(db, project, owner, title="Issue but no repo", number=60)
    task.github_issue_number = 850
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/sync-sub-issues",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 0


@pytest.mark.coverage
def test_sync_issue_comments_returns_zero_without_linked_repo(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CMT8")
    task = add_task(db, project, owner, title="Comments no repo", number=61)
    task.github_issue_number = 851
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/sync-issue-comments",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 0


@pytest.mark.coverage
def test_close_issue_rejects_task_without_github_issue(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLS2")
    task = add_task(db, project, owner, title="Unlinked close", number=62)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/close-issue",
        headers=headers,
    )
    assert response.status_code == 400
    assert "linked github issue" in response.json()["detail"].lower()


@pytest.mark.coverage
def test_close_issue_rejects_when_project_has_no_repo(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLS3")
    task = add_task(db, project, owner, title="No repo close", number=63)
    task.github_issue_number = 852
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/close-issue",
        headers=headers,
    )
    assert response.status_code == 400
    assert "repository" in response.json()["detail"].lower()


@pytest.mark.coverage
@patch("app.services.github_api_service.sync_issue_status", side_effect=RuntimeError("labels"))
@patch("app.services.github_api_service.update_issue_state")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_close_issue_succeeds_when_label_sync_fails(mock_reveal, mock_state, mock_sync, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLS4")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    done = CustomStatus(project_id=project.id, name="Complete", color="#0f0", category="done", position=0)
    db.add(done)
    task = add_task(db, project, owner, title="Label fail ok", number=64)
    task.github_issue_number = 853
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/close-issue",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    mock_state.assert_called_once()
    mock_sync.assert_called_once()
