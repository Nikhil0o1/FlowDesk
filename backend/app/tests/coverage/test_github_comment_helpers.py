"""Coverage — GitHub comment helpers and import edge cases."""
from unittest.mock import patch
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.comment import Comment
from app.models.github import GithubRepository
from app.models.project import Project
from app.schemas.github import IssueCreateBody, PersonalRepoLinkBody
from app.services import github_service
from app.tests.helpers import (
    add_task,
    build_project_stack,
    seed_github_repo,
    seed_project_github,
)


@pytest.mark.coverage
def test_format_flowdesk_github_comment_includes_marker():
    body = github_service.format_flowdesk_github_comment("Dev", "Hello team")
    assert "Dev (FlowDesk):" in body
    assert "Hello team" in body
    assert github_service.FLOWDESK_COMMENT_MARKER in body


@pytest.mark.coverage
def test_is_flowdesk_origin_github_comment():
    assert github_service.is_flowdesk_origin_github_comment(None) is False
    assert github_service.is_flowdesk_origin_github_comment("") is False
    marked = github_service.format_flowdesk_github_comment("Dev", "x")
    assert github_service.is_flowdesk_origin_github_comment(marked) is True


@pytest.mark.coverage
def test_extract_flowdesk_comment_body_parses_marker():
    raw = github_service.format_flowdesk_github_comment("Dev", "Parsed body")
    assert github_service._extract_flowdesk_comment_body(raw) == "Parsed body"


@pytest.mark.coverage
def test_sync_task_comment_to_github_returns_none_without_issue(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="No issue", number=70)
    assert github_service.sync_task_comment_to_github(db, task, "hi", "Dev") is None


@pytest.mark.coverage
def test_sync_task_comment_to_github_returns_none_without_repo(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="No repo", number=71)
    task.github_issue_number = 960
    db.flush()
    assert github_service.sync_task_comment_to_github(db, task, "hi", "Dev") is None


@pytest.mark.coverage
def test_sync_task_comment_to_github_returns_none_without_token(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner, token="")
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="No token", number=72)
    task.github_issue_number = 961
    db.flush()
    assert github_service.sync_task_comment_to_github(db, task, "hi", "Dev") is None


@pytest.mark.coverage
@patch("app.services.github_api_service.create_issue_comment", side_effect=RuntimeError("gh down"))
@patch("app.services.github_service.reveal", return_value="gh-token")
def test_sync_task_comment_to_github_swallows_api_errors(mock_reveal, _mock_comment, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Sync fail", number=73)
    task.github_issue_number = 962
    db.flush()
    assert github_service.sync_task_comment_to_github(db, task, "hi", "Dev") is None


@pytest.mark.coverage
def test_import_github_issue_comment_rejects_missing_id(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Import", number=74)
    task.github_issue_number = 963
    db.flush()
    assert github_service.import_github_issue_comment(db, repo, task, {"body": "x"}) is False


@pytest.mark.coverage
def test_import_github_issue_comment_skips_duplicate(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Dup", number=75)
    task.github_issue_number = 964
    db.add(
        Comment(
            task_id=task.id,
            author_id=owner.id,
            body="existing",
            github_comment_id=88001,
        )
    )
    db.flush()
    assert (
        github_service.import_github_issue_comment(
            db, repo, task, {"id": 88001, "body": "existing", "user": {"login": "dev"}}
        )
        is False
    )


@pytest.mark.coverage
def test_import_github_issue_comment_requires_project(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    repo = GithubRepository(
        workspace_id=workspace.id,
        project_id=None,
        repo_id=88110,
        repo_full_name="acme/orphan",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    task = add_task(db, project, owner, title="Orphan repo", number=76)
    task.github_issue_number = 965
    db.flush()
    assert (
        github_service.import_github_issue_comment(
            db, repo, task, {"id": 88002, "body": "ext", "user": {"login": "dev"}}
        )
        is False
    )


@pytest.mark.coverage
def test_import_github_issue_comment_creates_comment(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Import ok", number=77)
    task.github_issue_number = 966
    db.flush()
    ok = github_service.import_github_issue_comment(
        db,
        repo,
        task,
        {"id": 88003, "body": "From GitHub", "user": {"login": "external"}},
        actor_login="external",
    )
    assert ok is True
    comment = db.scalar(select(Comment).where(Comment.github_comment_id == 88003))
    assert comment is not None
    assert comment.body == "From GitHub"
    assert comment.github_author_login == "external"


@pytest.mark.coverage
def test_link_flowdesk_comment_to_github_id(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Link local", number=78)
    task.github_issue_number = 967
    local = Comment(task_id=task.id, author_id=owner.id, body="Local only")
    db.add(local)
    db.flush()
    gh_body = github_service.format_flowdesk_github_comment("Dev", "Local only")
    linked = github_service.import_github_issue_comment(
        db,
        repo,
        task,
        {"id": 88004, "body": gh_body, "user": {"login": "dev"}},
    )
    assert linked is True
    assert local.github_comment_id == 88004


@pytest.mark.coverage
def test_fallback_comment_author_id_uses_task_creator(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Creator", number=79)
    project_row = db.get(Project, project.id)
    assert github_service._fallback_comment_author_id(db, task, project_row) == owner.id


@pytest.mark.coverage
def test_sync_issue_comments_returns_zero_without_issue_number(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="No GH", number=80)
    assert github_service.sync_issue_comments_for_task(db, repo, task) == 0


@pytest.mark.coverage
def test_sync_issue_comments_returns_zero_without_project(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    repo = GithubRepository(
        workspace_id=workspace.id,
        project_id=None,
        repo_id=88111,
        repo_full_name="acme/no-proj",
        is_active=True,
        connected_by=owner.id,
    )
    db.add(repo)
    task = add_task(db, project, owner, title="No proj repo", number=81)
    task.github_issue_number = 968
    db.flush()
    assert github_service.sync_issue_comments_for_task(db, repo, task) == 0


@pytest.mark.coverage
def test_personal_repo_link_body_rejects_invalid_full_name():
    with pytest.raises(ValidationError):
        PersonalRepoLinkBody(project_id=uuid4(), repo_full_name="bad name")


@pytest.mark.coverage
def test_issue_create_body_rejects_invalid_optional_repo():
    with pytest.raises(ValidationError):
        IssueCreateBody(repo_full_name="not/a/valid/repo/name/extra")
