"""GitHub sync edge cases — _sync_github_issue early exits and residual github_service paths."""
from unittest.mock import MagicMock, patch

import pytest

from app.api.v1.tasks import _sync_github_issue
from app.core.task_ref import format_task_ref
from app.models.github import GithubRepository
from app.models.task import CustomStatus, Task
from app.services import github_service
from app.tests.helpers import (
    add_task,
    build_project_stack,
    seed_github_repo,
    seed_project_github,
)


@pytest.mark.coverage
def test_sync_github_issue_skips_without_issue_number(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="No issue", number=1)
    bg = MagicMock()
    _sync_github_issue(db, task, None, bg)
    bg.add_task.assert_not_called()


@pytest.mark.coverage
def test_sync_github_issue_skips_without_linked_repo(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="No repo", number=2)
    task.github_issue_number = 5
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(done)
    db.flush()
    bg = MagicMock()
    _sync_github_issue(db, task, done, bg)
    bg.add_task.assert_not_called()


@pytest.mark.coverage
def test_sync_github_issue_skips_on_invalid_repo_path(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, repo_full_name="invalid repo name")
    task = add_task(db, project, owner, title="Bad path", number=3)
    task.github_issue_number = 6
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(done)
    db.flush()
    bg = MagicMock()
    _sync_github_issue(db, task, done, bg)
    bg.add_task.assert_not_called()


@pytest.mark.coverage
def test_sync_github_issue_skips_without_token(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner, token="")
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="No token", number=4)
    task.github_issue_number = 7
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(done)
    db.flush()
    bg = MagicMock()
    _sync_github_issue(db, task, done, bg)
    bg.add_task.assert_not_called()


@pytest.mark.coverage
@patch("app.api.v1.tasks.github_api_service.sync_issue_status")
def test_sync_github_issue_schedules_background_sync(mock_sync, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Sync", number=5)
    task.github_issue_number = 8
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(done)
    db.flush()
    bg = MagicMock()
    _sync_github_issue(db, task, done, bg, title="New", body="Body")
    assert bg.add_task.call_count == 2


@pytest.mark.coverage
def test_find_linked_task_by_workspace_repo_when_no_project_id(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="WSR")
    task = add_task(db, project, owner, title="Workspace scoped", number=9)
    repo = GithubRepository(
        workspace_id=workspace.id,
        project_id=None,
        repo_id=88100,
        repo_full_name="acme/ws-only",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    ref = format_task_ref(project.id, 9)
    found = github_service.find_linked_task(db, repo, f"Fix {ref}")
    assert found is not None
    assert found.id == task.id


@pytest.mark.coverage
def test_apply_status_tags_skips_duplicate_refs(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="DUP")
    review = CustomStatus(
        project_id=project.id, name="In Review", color="#00f", category="in_progress", position=0
    )
    db.add(review)
    task = add_task(db, project, owner, title="Dup tag", number=10)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88101,
        repo_full_name="acme/dup-tag",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    ref = format_task_ref(project.id, 10)
    text = f"{ref}[In Review] and again {ref}[In Review]"
    moves = github_service.apply_status_tags(db, repo, "dev", "commit", text)
    assert len(moves) == 1


@pytest.mark.coverage
def test_github_pr_closed_without_merge_does_not_complete_task(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PRC")
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    todo = CustomStatus(project_id=project.id, name="To Do", color="#aaa", category="todo", position=1)
    db.add_all([done, todo])
    task = add_task(db, project, owner, title="PR close", number=11)
    task.status_id = todo.id
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88102,
        repo_full_name="acme/pr-close",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    ref = format_task_ref(project.id, 11)

    payload = {
        "action": "closed",
        "repository": {"id": 88102, "html_url": "https://github.com/acme/pr-close"},
        "pull_request": {
            "number": 60,
            "title": f"{ref} abandoned",
            "body": "",
            "html_url": "https://github.com/acme/pr-close/pull/60",
            "merged": False,
        },
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "pull_request", "pr-close-no-merge", payload)
    assert task.status_id == todo.id


@pytest.mark.coverage
def test_github_issue_reopened_moves_task_back_to_todo(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="REO")
    todo = CustomStatus(project_id=project.id, name="To Do", color="#aaa", category="todo", position=0)
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=1)
    db.add_all([todo, done])
    task = add_task(db, project, owner, title="Reopen", number=12)
    task.github_issue_number = 99
    task.status_id = done.id
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=88103,
        repo_full_name="acme/reopen",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "reopened",
        "repository": {"id": 88103, "html_url": "https://github.com/acme/reopen"},
        "issue": {"number": 99, "title": "Reopen", "html_url": "https://github.com/acme/reopen/issues/99"},
        "sender": {"login": "dev1"},
    }
    github_service.process_event(db, "issues", "reopen-edge", payload)
    assert task.status_id == todo.id


@pytest.mark.coverage
@patch("app.services.github_api_service.list_open_issues")
@patch("app.services.token_vault.reveal", return_value="gh-token")
def test_fetch_open_issues_generic_exception_returns_none(mock_reveal, mock_list, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    mock_list.side_effect = RuntimeError("network")

    issues = github_service._fetch_open_issues_for_repo(db, repo)
    assert issues is None


@pytest.mark.coverage
def test_sync_open_issues_delegates_to_backfill(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    with patch("app.services.github_service.backfill_open_issues", return_value=2) as mock_backfill:
        count = github_service.sync_open_issues(db, "unused-token", repo)
    assert count == 2
    mock_backfill.assert_called_once()


@pytest.mark.coverage
def test_backfill_returns_zero_without_project(db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    repo = GithubRepository(
        workspace_id=workspace.id,
        project_id=None,
        repo_id=88104,
        repo_full_name="acme/orphan",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    assert github_service.backfill_open_issues(db, repo) == 0


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue_comment")
@patch("app.services.github_api_service.list_open_issues", return_value=None)
@patch("app.services.token_vault.reveal", return_value="gh-token")
def test_backfill_returns_zero_when_fetch_fails(mock_reveal, mock_list, _mock_comment, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    assert github_service.backfill_open_issues(db, repo) == 0


@pytest.mark.coverage
@patch("app.services.github_api_service.list_sub_issues")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_sub_issues_returns_zero_when_list_fails(mock_reveal, mock_list, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    parent = add_task(db, project, owner, title="Parent", number=20)
    parent.github_issue_number = 900
    mock_list.side_effect = RuntimeError("api down")
    db.flush()

    assert github_service.sync_sub_issues_for_parent_task(db, repo, parent) == 0


@pytest.mark.coverage
@patch("app.services.github_api_service.list_issue_comments")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_issue_comments_returns_zero_when_list_fails(mock_reveal, mock_list, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Comments", number=21)
    task.github_issue_number = 901
    mock_list.side_effect = RuntimeError("api down")
    db.flush()

    assert github_service.sync_issue_comments_for_task(db, repo, task) == 0


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue_comment")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_create_synced_task_comment_stores_github_id(mock_reveal, mock_comment, db, org, owner):
    from app.models.comment import Comment
    from app.models.project import Project

    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Synced comment", number=22)
    task.github_issue_number = 902
    mock_comment.return_value = {"id": 99002}
    db.flush()
    project_row = db.get(Project, project.id)

    comment = github_service.create_synced_task_comment(
        db,
        task,
        project_row,
        owner.id,
        "Development panel note",
        author_name="Owner",
    )
    assert isinstance(comment, Comment)
    assert comment.github_comment_id == 99002
    assert comment.body == "Development panel note"


@pytest.mark.coverage
@patch("app.services.github_api_service.list_sub_issues")
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_sub_issues_links_existing_child_task(mock_reveal, mock_list, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    parent = add_task(db, project, owner, title="Parent link", number=23)
    parent.github_issue_number = 903
    existing = add_task(db, project, owner, title="Existing sub", number=24)
    existing.github_issue_number = 904
    mock_list.return_value = [
        {
            "number": 904,
            "title": "Existing sub",
            "body": "",
            "html_url": "https://github.com/acme/app/issues/904",
            "state": "open",
        },
    ]
    db.flush()

    synced = github_service.sync_sub_issues_for_parent_task(db, repo, parent)
    assert synced == 1
    assert existing.parent_task_id == parent.id
