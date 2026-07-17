"""Phase 6 — GitHub webhook event processing, issue sync, and title helpers."""
from unittest.mock import patch
from uuid import UUID

import pytest

from app.core.task_ref import format_task_ref, project_ref_prefix
from app.models.github import GithubRepository
from app.models.task import CustomStatus
from app.services import github_service
from app.services.github_issue_title import (
    format_github_issue_title,
    issue_title_matches_task,
    parse_github_issue_task_title,
)
from app.tests.helpers import (
    add_task,
    build_project_stack,
    seed_personal_github,
    seed_project_github,
)


@pytest.mark.coverage
def test_find_linked_task_by_project_key_ref(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GHK")
    task = add_task(db, project, owner, title="Linked", number=12)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99901,
        repo_full_name="acme/flowdesk",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    found = github_service.find_linked_task(db, repo, f"Fix {format_task_ref(project.id, 12)} login regression")
    assert found is not None
    assert found.id == task.id


@pytest.mark.coverage
def test_process_push_event_stores_github_event(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PUSH")
    add_task(db, project, owner, title="Push target", number=5)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99902,
        repo_full_name="acme/push-repo",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "repository": {"id": 99902, "html_url": "https://github.com/acme/push-repo"},
        "ref": "refs/heads/main",
        "commits": [{"message": f"{format_task_ref(project.id, 5)} ship fix"}],
        "sender": {"login": "dev1"},
        "compare": "https://github.com/acme/push-repo/compare/abc",
    }
    stored = github_service.process_event(db, "push", "delivery-push-1", payload)
    assert stored == 1


@pytest.mark.coverage
def test_apply_status_tag_moves_task(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="TAG")
    task = add_task(db, project, owner, title="Tagged", number=7)
    review = CustomStatus(
        project_id=project.id, name="In Review", color="#00f", category="in_progress", position=0
    )
    db.add(review)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99903,
        repo_full_name="acme/tags",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    moves = github_service.apply_status_tags(db, repo, "dev1", "commit", f"{format_task_ref(project.id, 7)}[In Review]")
    assert moves
    assert "In Review" in moves[0]
    assert task.status_id == review.id


@pytest.mark.coverage
def test_process_pull_request_opened_links_task(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PRJ")
    task = add_task(db, project, owner, title="Review me", number=4)
    review = CustomStatus(
        project_id=project.id, name="In Review", color="#00f", category="in_progress", position=0
    )
    db.add(review)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99904,
        repo_full_name="acme/pr-repo",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "opened",
        "repository": {"id": 99904, "html_url": "https://github.com/acme/pr-repo"},
        "pull_request": {
            "number": 42,
            "title": f"{format_task_ref(project.id, 4)} implement feature",
            "body": "Closes nothing",
            "html_url": "https://github.com/acme/pr-repo/pull/42",
            "merged": False,
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "pull_request", "delivery-pr-1", payload)
    assert stored == 1
    assert task.status_id == review.id


@pytest.mark.coverage
def test_issues_edited_syncs_task_title(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="Mobile App")
    task = add_task(db, project, owner, title="Fix login", number=3)
    task.github_issue_number = 55
    db.flush()
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99910,
        repo_full_name="acme/flowdesk",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "edited",
        "repository": {"id": 99910, "html_url": "https://github.com/acme/flowdesk"},
        "issue": {
            "number": 55,
            "title": "Mobile App/Updated title",
            "html_url": "https://github.com/acme/flowdesk/issues/55",
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "issues", "delivery-edit-1", payload)
    assert stored == 1
    assert task.title == "Updated title"


@pytest.mark.coverage
def test_issues_edited_syncs_task_description(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="Mobile App")
    task = add_task(db, project, owner, title="Fix login", number=4)
    task.description = "Old body"
    task.github_issue_number = 56
    db.flush()
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99911,
        repo_full_name="acme/flowdesk",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "edited",
        "repository": {"id": 99911, "html_url": "https://github.com/acme/flowdesk"},
        "issue": {
            "number": 56,
            "title": "Mobile App/Fix login",
            "body": "Updated from GitHub",
            "html_url": "https://github.com/acme/flowdesk/issues/56",
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "issues", "delivery-edit-2", payload)
    assert stored == 1
    assert task.description == "Updated from GitHub"


@pytest.mark.coverage
def test_issues_closed_moves_task_to_done(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLS")
    task = add_task(db, project, owner, title="Close me", number=5)
    task.github_issue_number = 88
    done = CustomStatus(
        project_id=project.id, name="Done", color="#0f0", category="done", position=1
    )
    db.add(done)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99912,
        repo_full_name="acme/close",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "closed",
        "repository": {"id": 99912, "html_url": "https://github.com/acme/close"},
        "issue": {
            "number": 88,
            "title": "Close me",
            "html_url": "https://github.com/acme/close/issues/88",
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "issues", "delivery-close-1", payload)
    assert stored == 1
    assert task.status_id == done.id


@pytest.mark.coverage
def test_issues_reopened_moves_task_to_todo(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ROP")
    task = add_task(db, project, owner, title="Reopen me", number=6)
    task.github_issue_number = 89
    todo = CustomStatus(
        project_id=project.id, name="To Do", color="#aaa", category="todo", position=0
    )
    done = CustomStatus(
        project_id=project.id, name="Done", color="#0f0", category="done", position=1
    )
    db.add_all([todo, done])
    db.flush()
    task.status_id = done.id
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99913,
        repo_full_name="acme/reopen",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "reopened",
        "repository": {"id": 99913, "html_url": "https://github.com/acme/reopen"},
        "issue": {
            "number": 89,
            "title": "Reopen me",
            "html_url": "https://github.com/acme/reopen/issues/89",
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "issues", "delivery-reopen-1", payload)
    assert stored == 1
    assert task.status_id == todo.id


@pytest.mark.coverage
def test_issues_labeled_moves_task_to_matching_status(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="LBL")
    task = add_task(db, project, owner, title="Label me", number=7)
    task.github_issue_number = 90
    in_progress = CustomStatus(
        project_id=project.id, name="In Progress", color="#00f", category="in_progress", position=1
    )
    db.add(in_progress)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99914,
        repo_full_name="acme/label",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    from app.services.github_api_service import FLOWDESK_LABEL_PREFIX

    payload = {
        "action": "labeled",
        "repository": {"id": 99914, "html_url": "https://github.com/acme/label"},
        "issue": {
            "number": 90,
            "title": "Label me",
            "html_url": "https://github.com/acme/label/issues/90",
        },
        "label": {"name": f"{FLOWDESK_LABEL_PREFIX}In Progress"},
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "issues", "delivery-label-1", payload)
    assert stored == 1
    assert task.status_id == in_progress.id


@pytest.mark.coverage
def test_process_issues_opened_creates_task_when_unlinked(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ISS")
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99905,
        repo_full_name="acme/issues",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    payload = {
        "action": "opened",
        "repository": {"id": 99905, "html_url": "https://github.com/acme/issues"},
        "issue": {
            "number": 7,
            "title": "Bug from GitHub",
            "body": "Details here",
            "html_url": "https://github.com/acme/issues/issues/7",
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "issues", "delivery-issue-1", payload)
    assert stored == 1
    from sqlalchemy import select
    from app.models.task import Task

    task = db.scalar(select(Task).where(Task.project_id == project.id, Task.title == "Bug from GitHub"))
    assert task is not None
    assert task.github_issue_number == 7


@pytest.mark.coverage
def test_process_issues_opened_links_existing_task_by_ref(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="LNK")
    task = add_task(db, project, owner, title="Existing", number=3)
    repo = GithubRepository(
        project_id=project.id,
        workspace_id=workspace.id,
        repo_id=99906,
        repo_full_name="acme/link",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    task_ref = format_task_ref(project.id, 3)

    payload = {
        "action": "opened",
        "repository": {"id": 99906, "html_url": "https://github.com/acme/link"},
        "issue": {
            "number": 12,
            "title": "Some issue",
            "body": f"Linked to FlowDesk task **{task_ref}**: Existing",
            "html_url": "https://github.com/acme/link/issues/12",
        },
        "sender": {"login": "dev1"},
    }
    stored = github_service.process_event(db, "issues", "delivery-link-1", payload)
    assert stored == 1
    assert task.github_issue_number == 12
    assert task.github_issue_url == "https://github.com/acme/link/issues/12"


@pytest.mark.coverage
def test_project_ref_prefix_is_stable_hex():
    pid = UUID("550e8400-e29b-41d4-a716-446655440000")
    assert project_ref_prefix(pid) == "550E8400"
    assert format_task_ref(pid, 42) == "550E8400-42"


@pytest.mark.coverage
def test_format_and_parse_github_issue_title():
    assert format_github_issue_title("Mobile App", "Fix login") == "Mobile App/Fix login"
    assert format_github_issue_title("Mobile App", "  ") == "Mobile App/Untitled"
    assert parse_github_issue_task_title("Mobile App/Fix login", "Mobile App") == "Fix login"
    assert parse_github_issue_task_title("550E8400-42: Fix login", "Mobile App") == "Fix login"
    assert parse_github_issue_task_title("Standalone issue", "Mobile App") == "Standalone issue"
    assert parse_github_issue_task_title("") == "Untitled"
    assert parse_github_issue_task_title("Mobile App /Fix login", "Mobile App") == "Fix login"
    assert issue_title_matches_task("Mobile App/Fix login", "Mobile App", "Fix login")
    assert not issue_title_matches_task("Mobile App/Other", "Mobile App", "Fix login")


@pytest.mark.coverage
def test_connections_for_repo_sync_includes_project_connection(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    project_conn = seed_project_github(db, org, project, owner)
    personal = seed_personal_github(db, org, owner)
    repo = GithubRepository(
        connection_id=personal.id,
        workspace_id=workspace.id,
        project_id=project.id,
        repo_id=999,
        repo_full_name="acme/app",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    connections = github_service._connections_for_repo_sync(db, repo)
    assert len(connections) == 2
    assert connections[0].id == personal.id
    assert connections[1].id == project_conn.id


@pytest.mark.coverage
@patch("app.services.github_service._fetch_open_issues_for_repo")
def test_sync_project_issues_imports_for_each_repo(mock_fetch, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = GithubRepository(
        connection_id=conn.id,
        workspace_id=workspace.id,
        project_id=project.id,
        repo_id=1001,
        repo_full_name="acme/one",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.commit()

    def _fake_fetch(db, repo, **kwargs):
        if repo.repo_full_name == "acme/one":
            return [{"number": 1, "title": "From GitHub", "html_url": "https://github.com/acme/one/issues/1"}]
        return []

    mock_fetch.side_effect = _fake_fetch
    imported, status_synced = github_service.sync_project_issues(db, project.id)
    assert imported == 1
    assert status_synced == 0


@pytest.mark.coverage
@patch("app.services.github_api_service.list_open_issues")
@patch("app.services.token_vault.reveal", return_value="gh-token")
def test_fetch_open_issues_retries_project_token(mock_reveal, mock_list, db, org, owner):
    from app.services.github_api_service import GitHubApiError

    workspace, project = build_project_stack(db, org, owner)
    personal = seed_personal_github(db, org, owner)
    seed_project_github(db, org, project, owner)
    repo = GithubRepository(
        connection_id=personal.id,
        workspace_id=workspace.id,
        project_id=project.id,
        repo_id=1002,
        repo_full_name="acme/two",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()

    mock_list.side_effect = [
        GitHubApiError(401, "expired"),
        [{"number": 2, "title": "OK", "html_url": "https://github.com/acme/two/issues/2"}],
    ]
    issues = github_service._fetch_open_issues_for_repo(db, repo)
    assert issues is not None
    assert issues[0]["number"] == 2
    assert mock_list.call_count == 2


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue_comment")
@patch("app.services.github_api_service.list_open_issues")
@patch("app.services.token_vault.reveal", return_value="gh-token")
def test_backfill_open_issues_creates_tasks_and_events(
    mock_reveal, mock_list, mock_comment, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_name="Import")
    conn = seed_project_github(db, org, project, owner)
    repo = GithubRepository(
        connection_id=conn.id,
        workspace_id=workspace.id,
        project_id=project.id,
        repo_id=1003,
        repo_full_name="acme/import",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.flush()
    mock_list.return_value = [
        {
            "number": 4,
            "title": "Import/From GitHub",
            "body": "details",
            "html_url": "https://github.com/acme/import/issues/4",
            "user": {"login": "dev"},
        }
    ]

    created = github_service.backfill_open_issues(db, repo)
    assert created == 1

    from sqlalchemy import select
    from app.models.task import Task

    task = db.scalar(select(Task).where(Task.project_id == project.id, Task.title == "From GitHub"))
    assert task is not None
    assert task.github_issue_number == 4
    mock_comment.assert_called_once()


@pytest.mark.coverage
@patch("app.services.github_service.sync_project_issues", return_value=(3, 0))
def test_github_sync_fallback_job(mock_sync, db, org, owner):
    from workers import jobs

    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = GithubRepository(
        connection_id=conn.id,
        workspace_id=workspace.id,
        project_id=project.id,
        repo_id=1004,
        repo_full_name="acme/fallback",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.commit()

    assert jobs.github_sync_fallback(db) == 3
    mock_sync.assert_called_once_with(db, project.id)


@pytest.mark.coverage
@patch("app.services.github_service.sync_project_issues", side_effect=RuntimeError("gh down"))
def test_github_sync_fallback_survives_project_failure(mock_sync, db, org, owner):
    from workers import jobs

    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = GithubRepository(
        connection_id=conn.id,
        workspace_id=workspace.id,
        project_id=project.id,
        repo_id=1005,
        repo_full_name="acme/fail",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    db.commit()

    assert jobs.github_sync_fallback(db) == 0


@pytest.mark.coverage
@patch("app.services.github_service.sync_project_issues", side_effect=[RuntimeError("fail"), (2, 0)])
def test_github_sync_fallback_continues_across_projects(mock_sync, db, org, owner):
    from workers import jobs

    workspace_a, project_a = build_project_stack(db, org, owner, project_name="Alpha")
    conn_a = seed_project_github(db, org, project_a, owner)
    db.add(
        GithubRepository(
            connection_id=conn_a.id,
            workspace_id=workspace_a.id,
            project_id=project_a.id,
            repo_id=1006,
            repo_full_name="acme/alpha",
            is_active=True,
            connected_by=owner.id,
        )
    )
    workspace_b, project_b = build_project_stack(db, org, owner, project_name="Beta")
    conn_b = seed_project_github(db, org, project_b, owner)
    db.add(
        GithubRepository(
            connection_id=conn_b.id,
            workspace_id=workspace_b.id,
            project_id=project_b.id,
            repo_id=1007,
            repo_full_name="acme/beta",
            is_active=True,
            connected_by=owner.id,
        )
    )
    db.commit()

    assert jobs.github_sync_fallback(db) == 2
    assert mock_sync.call_count == 2
