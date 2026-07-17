"""Coverage — auth, invite, google, sheet sync, github service, redis, lifecycle gaps."""
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.core import lifecycle
from app.core.security import generate_token, hash_token
from app.core.task_ref import format_task_ref
from app.models.github import GithubRepository
from app.models.integration import GoogleSheetSync
from app.models.invite import Invite
from app.models.task import CustomStatus, Task
from app.services import auth_service, github_service, google_service, invite_service, sheet_sync_service as sheets
from app.tests.conftest import make_user
from app.tests.helpers import add_task, build_project_stack, seed_google_connection


@pytest.mark.coverage
def test_redis_client_pool_and_ping(monkeypatch):
    from app.core import redis_client

    redis_client.get_redis_pool.cache_clear()
    assert redis_client.get_redis_pool("", 5) is None

    pool = redis_client.get_redis_pool("redis://localhost:6379/0", 2)
    assert pool is not None

    fake = MagicMock()
    fake.ping.return_value = True
    monkeypatch.setattr(redis_client, "get_redis_client", lambda: fake)
    assert redis_client.redis_ping() is True

    fake.ping.side_effect = RuntimeError("down")
    assert redis_client.redis_ping() is False


@pytest.mark.coverage
@patch("app.core.lifecycle.ensure_migrations_current")
def test_lifecycle_production_validation_raises(mock_migrations, monkeypatch):
    monkeypatch.setattr("app.core.lifecycle.settings.ENVIRONMENT", "production")
    monkeypatch.setattr("app.core.lifecycle.settings.SECRET_KEY", "")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        lifecycle.validate_runtime_config()
    mock_migrations.assert_called_once()


@pytest.mark.coverage
@patch("app.core.lifecycle.ensure_migrations_current")
@patch("workers.scheduler.start_scheduler")
def test_lifecycle_start_and_stop_scheduler(mock_start, _mock_migrations, monkeypatch):
    scheduler = MagicMock()
    mock_start.return_value = scheduler
    monkeypatch.setattr("app.core.lifecycle.settings.ENVIRONMENT", "development")
    assert lifecycle.start_scheduler() is scheduler

    with patch("workers.scheduler.shutdown_scheduler") as mock_shutdown:
        lifecycle.stop_services(scheduler)
        mock_shutdown.assert_called_once()


@pytest.mark.coverage
@patch("app.services.auth_service.google_id_token.verify_oauth2_token", side_effect=ValueError("bad"))
def test_login_with_google_invalid_token(_mock, db, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "cid")
    with pytest.raises(auth_service.AuthError, match="could not be verified"):
        auth_service.login_with_google(db, "token")


@pytest.mark.coverage
@patch("app.services.auth_service.google_id_token.verify_oauth2_token")
def test_login_with_google_inactive_user(mock_verify, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "cid")
    owner.is_active = False
    db.flush()
    mock_verify.return_value = {"email": owner.email, "email_verified": True, "sub": "sub"}
    with pytest.raises(auth_service.AuthError, match="deactivated"):
        auth_service.login_with_google(db, "token")


@pytest.mark.coverage
def test_login_with_microsoft_not_configured(db, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_CLIENT_ID", "")
    with pytest.raises(HTTPException) as exc:
        auth_service.login_with_microsoft(db, "token")
    assert exc.value.status_code == 503


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_create_invite_invalid_role_and_existing_member(_mock, db, org, owner):
    with pytest.raises(HTTPException) as exc:
        invite_service.create_invite(
            db,
            inviter=owner,
            email="bad@test.dev",
            scope="project",
            role="owner",
            organization_id=org.id,
        )
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as exc2:
        invite_service.create_invite(
            db,
            inviter=owner,
            email=owner.email,
            scope="organization",
            role="member",
            organization_id=org.id,
        )
    assert exc2.value.status_code == 409


@pytest.mark.coverage
@patch("app.services.invite_service.email_service")
def test_preview_invite_and_project_onboarding_email(_mock, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    raw = generate_token()
    invite = Invite(
        email="newproj@test.dev",
        token_hash=hash_token(raw),
        invited_by=owner.id,
        scope="project",
        role="member",
        organization_id=org.id,
        workspace_id=workspace.id,
        project_id=project.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=5),
        status="pending",
    )
    db.add(invite)
    db.commit()

    preview = invite_service.preview_invite(db, raw)
    assert preview["target_name"] == project.name
    assert preview["existing_user"] is False


@pytest.mark.coverage
@patch("app.services.google_service.http.post")
def test_try_gmail_send_success(mock_post, db, owner, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.EMAIL_FROM", "no-reply@flowdesk.test")
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True)
    assert google_service.try_gmail_send(db, owner.id, owner.email, "Hi", "<p>Hi</p>") is True


@pytest.mark.coverage
@patch("app.services.google_service.http.get")
@patch("app.services.google_service.fresh_access_token", return_value="tok")
def test_gmail_search_returns_metadata(mock_token, mock_get, db, owner):
    conn = seed_google_connection(db, owner)
    list_resp = MagicMock(ok=True, json=lambda: {"messages": [{"id": "m1"}]})
    detail_resp = MagicMock(
        ok=True,
        json=lambda: {
            "id": "m1",
            "snippet": "hello",
            "payload": {"headers": [{"name": "Subject", "value": "Test"}, {"name": "From", "value": "a@b.dev"}]},
        },
    )
    mock_get.side_effect = [list_resp, detail_resp]
    results = google_service.gmail_search(db, conn, "from:test")
    assert len(results) == 1
    assert results[0]["subject"] == "Test"


@pytest.mark.coverage
@patch("app.services.google_service.http.post")
@patch("app.services.google_service.fresh_access_token", return_value="tok")
def test_calendar_create_timed_event_with_meet(mock_token, mock_post, db, owner):
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"id": "evt", "htmlLink": "https://cal"})
    start = datetime.now(timezone.utc)
    end = start + timedelta(hours=1)
    out = google_service.calendar_create_timed_event(
        db,
        conn,
        summary="Standup",
        description="Daily",
        start_at=start,
        end_at=end,
        add_meet=True,
        attendees=[owner.email],
    )
    assert out["id"] == "evt"


@pytest.mark.coverage
def test_sheet_sync_apply_cell_branches(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CEL")
    status = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(status)
    task = add_task(db, project, owner, title="Cell task", number=1)
    task.priority = "normal"
    task.labels = ["a"]
    db.flush()
    status_map = {status.name.lower(): status}

    assert sheets._apply_cell(db, task, "Title", "Renamed", status_map) is True
    assert sheets._apply_cell(db, task, "Priority", "not-a-priority", status_map) is False
    assert sheets._apply_cell(db, task, "Story points", "nope", status_map) is False
    assert sheets._apply_cell(db, task, "Labels", "beta, gamma", status_map) is True
    assert sheets._apply_cell(db, task, "Due date", "2099-01-15", status_map) is True


@pytest.mark.coverage
def test_sheet_sync_workspace_user_lookup(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    lookup = sheets._workspace_user_lookup(db, workspace.id)
    assert owner.email.lower() in lookup
    assert lookup[owner.email.lower()] == owner.id


@pytest.mark.coverage
def test_github_service_find_linked_task_and_status_tags(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GHS")
    todo = CustomStatus(project_id=project.id, name="Review", color="#00f", category="in_progress", position=0)
    db.add(todo)
    task = add_task(db, project, owner, title="Tagged", number=7)
    task.github_issue_number = 55
    db.flush()
    repo = GithubRepository(
        connection_id=None,
        workspace_id=workspace.id,
        project_id=project.id,
        repo_id=44001,
        repo_full_name="acme/app",
        default_branch="main",
        is_active=True,
    )
    db.add(repo)
    db.flush()

    by_issue = github_service.find_linked_task(db, repo, github_issue_number=55)
    assert by_issue.id == task.id

    by_text = github_service.find_linked_task(db, repo, f"Fix {format_task_ref(project.id, 7)} please")
    assert by_text.id == task.id

    moves = github_service.apply_status_tags(
        db, repo, "dev", "push", f"{format_task_ref(project.id, 7)}[Review]"
    )
    assert moves == [f"{format_task_ref(project.id, 7)} → Review"]


@pytest.mark.coverage
@patch("app.services.auth_service.email_service.send_login_otp_email")
def test_request_login_otp_sends_for_active_user(mock_send, db, org, owner):
    auth_service.request_login_otp(db, owner.email)
    mock_send.assert_called_once()


@pytest.mark.coverage
def test_revoke_and_check_access_token(db, org, owner):
    from app.core.security import create_access_token

    token = create_access_token(owner.id, owner.is_platform_superadmin)
    auth_service.revoke_access_token_from_raw(db, token)
    db.commit()
    from app.core.security import decode_access_token

    payload = decode_access_token(token)
    assert auth_service.is_access_token_revoked(db, payload["jti"]) is True


@pytest.mark.coverage
@patch("app.services.google_service.http.get")
@patch("app.services.google_service.fresh_access_token", return_value="tok")
def test_google_sheets_read_and_write(mock_token, mock_get, db, owner):
    conn = seed_google_connection(db, owner)
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"values": [["A", "B"]]})
    rows = google_service.sheets_read(db, conn, "sheet-id", "Sheet1!A1")
    assert rows == [["A", "B"]]

    with patch("app.services.google_service.http.put") as mock_put:
        mock_put.return_value = MagicMock(ok=True)
        google_service.sheets_overwrite(db, conn, "sheet-id", [["X", "Y"]])
        mock_put.assert_called_once()


@pytest.mark.coverage
@patch("app.core.lifecycle.ensure_migrations_current")
def test_lifecycle_production_checks_debug_and_webhook(mock_migrations, monkeypatch):
    monkeypatch.setattr("app.core.lifecycle.settings.ENVIRONMENT", "production")
    monkeypatch.setattr("app.core.lifecycle.settings.SECRET_KEY", "real-production-secret")
    monkeypatch.setattr("app.core.lifecycle.settings.DEBUG", True)
    with pytest.raises(RuntimeError, match="DEBUG"):
        lifecycle.validate_runtime_config()

    monkeypatch.setattr("app.core.lifecycle.settings.DEBUG", False)
    monkeypatch.setattr("app.core.lifecycle.settings.GITHUB_WEBHOOK_SECRET", "")
    with pytest.raises(RuntimeError, match="GITHUB_WEBHOOK_SECRET"):
        lifecycle.validate_runtime_config()
