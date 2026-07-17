"""Coverage — high-yield gaps across github API webhook, auth, google, tasks, sheet sync."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.models.integration import GoogleSheetSync
from app.services import auth_service, github_service, google_service, sheet_sync_service as sheets
from app.tests.conftest import auth_headers, seed_login_otp
from app.tests.coverage.test_github_legacy import _sign
from app.tests.helpers import (
    add_project_member,
    add_task,
    build_project_stack,
    seed_github_repo,
    seed_google_connection,
    seed_personal_github,
    seed_project_github,
)


@pytest.mark.coverage
def test_github_webhook_push_stores_event(client, db, org, owner, monkeypatch):
    class _DbProxy:
        def __init__(self, session):
            self._session = session

        def __getattr__(self, name):
            return getattr(self._session, name)

        def close(self):
            pass

    monkeypatch.setattr("app.db.session.SessionLocal", lambda: _DbProxy(db))
    workspace, project = build_project_stack(db, org, owner, project_key="WHK")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, repo_id=88001)
    add_task(db, project, owner, title="Webhook task", number=1)

    payload_dict = {
        "repository": {"id": 88001, "html_url": "https://github.com/acme/whk"},
        "ref": "refs/heads/main",
        "commits": [{"message": "WHK-1 fix"}],
        "sender": {"login": "bot"},
    }
    payload = json.dumps(payload_dict).encode()
    response = client.post(
        "/api/v1/github/webhook",
        content=payload,
        headers={
            "X-GitHub-Event": "push",
            "X-GitHub-Delivery": "delivery-whk-1",
            "X-Hub-Signature-256": _sign(payload),
            "Content-Type": "application/json",
        },
    )
    assert response.status_code == 200
    assert response.json()["stored"] >= 1


@pytest.mark.coverage
@patch("app.services.auth_service.google_id_token.verify_oauth2_token")
def test_login_with_google_sets_avatar(mock_verify, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "cid")
    mock_verify.return_value = {
        "email": owner.email,
        "email_verified": True,
        "sub": "google-sub-1",
        "picture": "https://avatar.example/a.png",
    }
    user, _ctx = auth_service.login_with_google(db, "token")
    assert user.google_sub == "google-sub-1"
    assert user.profile.avatar_url == "https://avatar.example/a.png"


@pytest.mark.coverage
@patch("app.services.auth_service._microsoft_jwks_client")
def test_login_with_microsoft_rejects_consumer_tenant(mock_jwks, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_CLIENT_ID", "ms-cid")
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_TENANT", "organizations")
    owner.microsoft_sub = "ms-oid"
    db.flush()

    key = MagicMock()
    key.key = "secret"
    mock_jwks.return_value.get_signing_key_from_jwt.return_value = key
    tid = auth_service._MS_CONSUMER_TENANT
    with patch("app.services.auth_service.jwt.decode") as mock_decode:
        mock_decode.return_value = {
            "tid": tid,
            "iss": f"https://login.microsoftonline.com/{tid}/v2.0",
            "oid": "ms-oid",
            "email": owner.email,
            "email_verified": True,
        }
        with pytest.raises(auth_service.AuthError, match="not allowed"):
            auth_service.login_with_microsoft(db, "ms-token")


@pytest.mark.coverage
def test_fresh_access_token_returns_cached_when_valid(db, owner):
    conn = seed_google_connection(db, owner)
    conn.token_expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    token = google_service.fresh_access_token(db, conn)
    assert token == "test-access-token"


@pytest.mark.coverage
def test_try_gmail_send_without_scope_returns_false(db, owner):
    conn = seed_google_connection(db, owner)
    conn.scope = google_service.SCOPE_CALENDAR
    db.flush()
    assert google_service.try_gmail_send(db, owner.id, owner.email, "Hi", "<p>Hi</p>") is False


@pytest.mark.coverage
@patch("app.services.google_service.http.post")
def test_calendar_create_event_api_error(mock_post, db, owner):
    from datetime import date

    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=False, status_code=500)
    with pytest.raises(HTTPException) as exc:
        google_service.calendar_create_event(db, conn, summary="X", description="Y", day=date.today())
    assert exc.value.status_code == 502


@pytest.mark.coverage
@patch("app.services.sheet_sync_service.google_service.sheets_overwrite")
@patch("app.services.sheet_sync_service.google_service.sheets_read")
def test_run_sync_export_only(mock_read, mock_overwrite, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="EXP")
    add_task(db, project, owner, title="Export me", number=1)
    conn = seed_google_connection(db, owner)
    sync = GoogleSheetSync(
        project_id=project.id,
        connection_id=conn.id,
        spreadsheet_id="sheet-export",
        spreadsheet_url="https://sheets/export",
        sync_mode="export",
        created_by=owner.id,
        snapshot={},
    )
    db.add(sync)
    db.flush()
    mock_read.return_value = []

    assert sheets.run_sync(db, sync) is True


@pytest.mark.coverage
def test_github_process_event_duplicate_delivery_is_noop(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="DUP")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, repo_id=88002)
    payload = {
        "repository": {"id": 88002, "html_url": "https://github.com/acme/dup"},
        "ref": "refs/heads/main",
        "commits": [],
        "sender": {"login": "dev"},
    }
    assert github_service.process_event(db, "push", "dup-delivery", payload) == 1
    assert github_service.process_event(db, "push", "dup-delivery", payload) == 0


@pytest.mark.coverage
def test_task_remove_assignee_and_share_member_by_user_id(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SHR")
    member = add_project_member(db, org, workspace, project, "share-mem@test.dev")
    task = add_task(db, project, owner, title="Shared", number=3)
    task.is_private = True
    from app.models.task import TaskAssignee

    db.add(TaskAssignee(task_id=task.id, user_id=member.id))
    db.flush()
    headers = auth_headers(client, owner.email)

    added = client.post(
        f"/api/v1/tasks/{task.id}/share/members",
        headers=headers,
        json={"user_id": str(member.id)},
    )
    assert added.status_code == 201

    removed = client.delete(f"/api/v1/tasks/{task.id}/assignees/{member.id}", headers=headers)
    assert removed.status_code == 200


@pytest.mark.coverage
def test_github_create_issue_no_repo_connected(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="NRP")
    seed_personal_github(db, org, owner)
    task = add_task(db, project, owner, title="No repo", number=1)
    headers = auth_headers(client, owner.email)

    response = client.post(f"/api/v1/github/tasks/{task.id}/create-issue", headers=headers)
    assert response.status_code == 400
