"""Integration — GitHub OAuth error paths, connect-repo guards, and create-issue 502."""
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import jwt
import pytest
from fastapi import HTTPException
from sqlalchemy import select
from uuid import uuid4

from app.api.v1 import github as github_api
from app.core.config import settings
from app.models.github import CONNECTION_PERSONAL, CONNECTION_PROJECT, GithubConnection, GithubRepository
from app.services import github_api_service as gh_api
from app.tests.conftest import auth_headers
from app.tests.helpers import (
    add_task,
    build_project_stack,
    seed_github_repo,
    seed_personal_github,
    seed_project_github,
)

_GH_OAUTH_COOKIE = "flowdesk_gh_oauth"


def _github_oauth_state(*, org_id, user_id, conn_type: str = CONNECTION_PERSONAL, project_id=None, next_target="apps"):
    nonce = secrets.token_urlsafe(24)
    state = jwt.encode(
        {
            "type": conn_type,
            "org_id": str(org_id),
            "project_id": str(project_id) if project_id else None,
            "user_id": str(user_id),
            "next": next_target,
            "nonce": nonce,
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        settings.SECRET_KEY,
        algorithm="HS256",
    )
    return state, nonce


@pytest.mark.integration
def test_github_oauth_authorize_not_configured(client, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "")
    headers = auth_headers(client, owner.email)

    response = client.get(
        f"/api/v1/github/oauth/authorize?type=personal&org_id={org.id}",
        headers=headers,
    )
    assert response.status_code == 501


@pytest.mark.integration
def test_github_oauth_authorize_missing_params(client, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    headers = auth_headers(client, owner.email)

    personal = client.get("/api/v1/github/oauth/authorize?type=personal", headers=headers)
    assert personal.status_code == 422

    project = client.get("/api/v1/github/oauth/authorize?type=project", headers=headers)
    assert project.status_code == 422


@pytest.mark.integration
def test_github_oauth_callback_error_and_exchange_failures(client, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_SECRET", "gh-secret")
    state, nonce = _github_oauth_state(org_id=org.id, user_id=owner.id)

    denied = client.get(
        "/api/v1/github/oauth/callback",
        params={"error": "access_denied", "state": state},
        cookies={_GH_OAUTH_COOKIE: nonce},
        follow_redirects=False,
    )
    assert denied.status_code == 307
    assert "github_error=1" in denied.headers["location"]

    with patch("app.api.v1.github.http_requests.post", side_effect=RuntimeError("network")):
        failed = client.get(
            "/api/v1/github/oauth/callback",
            params={"code": "bad-code", "state": state},
            cookies={_GH_OAUTH_COOKIE: nonce},
            follow_redirects=False,
        )
    assert failed.status_code == 307
    assert "github_error=1" in failed.headers["location"]


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.get_authenticated_user", side_effect=RuntimeError("gh user"))
@patch("app.api.v1.github.http_requests.post")
def test_github_oauth_callback_no_token_or_user(mock_post, _mock_user, client, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_SECRET", "gh-secret")
    state, nonce = _github_oauth_state(org_id=org.id, user_id=owner.id)

    mock_post.return_value = MagicMock(
        raise_for_status=lambda: None,
        json=lambda: {"scope": "repo"},
    )
    no_token = client.get(
        "/api/v1/github/oauth/callback",
        params={"code": "oauth-code", "state": state},
        cookies={_GH_OAUTH_COOKIE: nonce},
        follow_redirects=False,
    )
    assert "github_error=1" in no_token.headers["location"]

    mock_post.return_value = MagicMock(
        raise_for_status=lambda: None,
        json=lambda: {"access_token": "tok", "scope": "repo"},
    )
    user_fail = client.get(
        "/api/v1/github/oauth/callback",
        params={"code": "oauth-code", "state": state},
        cookies={_GH_OAUTH_COOKIE: nonce},
        follow_redirects=False,
    )
    assert "github_error=1" in user_fail.headers["location"]


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.get_authenticated_user")
@patch("app.api.v1.github.http_requests.post")
def test_github_oauth_callback_updates_existing_project_connection(
    mock_post, mock_gh_user, client, db, org, owner, monkeypatch
):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_SECRET", "gh-secret")
    workspace, project = build_project_stack(db, org, owner)
    seed_project_github(db, org, project, owner, github_user_login="old-bot")
    state, nonce = _github_oauth_state(
        org_id=org.id, user_id=owner.id, conn_type=CONNECTION_PROJECT, project_id=project.id, next_target="planner"
    )

    mock_post.return_value = MagicMock(
        raise_for_status=lambda: None,
        json=lambda: {"access_token": "new-token", "scope": "repo"},
    )
    mock_gh_user.return_value = {"login": "new-bot", "id": 99999}

    response = client.get(
        "/api/v1/github/oauth/callback",
        params={"code": "oauth-code", "state": state},
        cookies={_GH_OAUTH_COOKIE: nonce},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "github_connected=1" in response.headers["location"]
    assert "/app/planner" in response.headers["location"]

    conn = db.scalar(
        select(GithubConnection).where(
            GithubConnection.project_id == project.id,
            GithubConnection.connection_type == CONNECTION_PROJECT,
        )
    )
    assert conn.github_user_login == "new-bot"


@pytest.mark.integration
def test_connect_repo_without_project_connection(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/app"},
    )
    assert response.status_code == 400
    assert "no GitHub connection" in response.json()["detail"]


@pytest.mark.integration
def test_patch_connection_settings_requires_connection(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/github/projects/{project.id}/connection/settings",
        headers=headers,
        json={"branch_name_format": ":taskId:"},
    )
    assert response.status_code == 400


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_issue", side_effect=RuntimeError("gh api down"))
def test_create_github_issue_returns_502(mock_issue, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="502")
    conn = seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="API fail", number=1)
    headers = auth_headers(client, owner.email)

    response = client.post(f"/api/v1/github/tasks/{task.id}/create-issue", headers=headers)
    assert response.status_code == 502
    mock_issue.assert_called_once()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.api.v1.github.github_api_service.create_issue")
def test_create_github_issue_maps_github_api_error(mock_issue, mock_get_repo, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="403")
    seed_personal_github(db, org, owner)
    task = add_task(db, project, owner, title="Forbidden", number=3)
    mock_get_repo.return_value = {"id": 77, "default_branch": "main"}
    mock_issue.side_effect = gh_api.GitHubApiError(403, "forbidden")
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/create-issue",
        headers=headers,
        json={"repo_full_name": "dev-user/alpha"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "forbidden"


def _sign(payload: bytes) -> str:
    secret = settings.GITHUB_WEBHOOK_SECRET or "flowdesk-dev"
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


@pytest.mark.integration
def test_github_webhook_rejects_bad_signature_and_json(client, monkeypatch):
    monkeypatch.setattr("app.services.github_service.settings.GITHUB_WEBHOOK_SECRET", "ci-webhook-secret")
    payload = b"not-json"
    bad_sig = client.post(
        "/api/v1/github/webhook",
        content=payload,
        headers={
            "X-GitHub-Event": "push",
            "X-Hub-Signature-256": "sha256=deadbeef",
            "Content-Type": "application/json",
        },
    )
    assert bad_sig.status_code == 401

    good_sig_bad_json = client.post(
        "/api/v1/github/webhook",
        content=payload,
        headers={
            "X-GitHub-Event": "push",
            "X-Hub-Signature-256": _sign(payload),
            "Content-Type": "application/json",
        },
    )
    assert good_sig_bad_json.status_code == 400


@pytest.mark.integration
def test_github_webhook_ignores_unknown_event(client):
    payload = json.dumps({"repository": {"id": 1}}).encode()
    response = client.post(
        "/api/v1/github/webhook",
        content=payload,
        headers={
            "X-GitHub-Event": "workflow_run",
            "X-GitHub-Delivery": "ignored-1",
            "X-Hub-Signature-256": _sign(payload),
            "Content-Type": "application/json",
        },
    )
    assert response.status_code == 200
    assert response.json()["ignored"] == "workflow_run"


@pytest.mark.integration
def test_github_oauth_authorize_sanitizes_return_path(client, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    headers = auth_headers(client, owner.email)

    planner = client.get(
        f"/api/v1/github/oauth/authorize?type=personal&org_id={org.id}&next=planner",
        headers=headers,
    )
    assert planner.status_code == 200

    unsafe = client.get(
        f"/api/v1/github/oauth/authorize?type=personal&org_id={org.id}&next=..%2Fevil",
        headers=headers,
    )
    assert unsafe.status_code == 200


@pytest.mark.integration
@patch("app.services.github_api_service.revoke_authorization")
@patch("app.services.github_api_service.revoke_token")
def test_disconnect_personal_connection(mock_revoke_token, mock_revoke_grant, client, db, org, owner):
    seed_personal_github(db, org, owner)
    headers = auth_headers(client, owner.email)

    deleted = client.delete(f"/api/v1/github/organizations/{org.id}/personal-connection", headers=headers)
    assert deleted.status_code == 200
    status = client.get(f"/api/v1/github/organizations/{org.id}/personal-connection", headers=headers)
    assert status.json()["connected"] is False


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.open_pull_request_for_branch", side_effect=RuntimeError("pr fail"))
def test_create_task_pr_returns_502(mock_open_pr, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PR5")
    conn = seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    repo = seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="PR fail", number=2)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/tasks/{task.id}/create-pr",
        headers=headers,
        json={"repository_id": str(repo.id), "head": "feature/x", "base": "main"},
    )
    assert response.status_code == 502


@pytest.mark.integration
def test_project_connection_only_connector_can_disconnect(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="GDC")
    from app.tests.helpers import add_project_member

    other_admin = add_project_member(db, org, workspace, project, "other-gh-admin@test.dev", role="admin")
    seed_project_github(db, org, project, owner)
    other_headers = auth_headers(client, other_admin.email)
    denied = client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=other_headers)
    assert denied.status_code == 403

    owner_headers = auth_headers(client, owner.email)
    allowed = client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=owner_headers)
    assert allowed.status_code == 200


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.verify_token", return_value=False)
def test_project_connection_status_flags_reconnect_when_token_invalid(mock_verify, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="REC")
    seed_project_github(db, org, project, owner)
    headers = auth_headers(client, owner.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert status.status_code == 200
    body = status.json()
    assert body["connected"] is False
    assert body["needs_reconnect"] is True
    assert body["can_connect"] is True
    assert body["github_user_login"] == "proj-bot"


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.verify_token", return_value=False)
def test_project_oauth_authorize_allows_connector_reconnect(mock_verify, client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    workspace, project = build_project_stack(db, org, owner, project_key="RAU")
    seed_project_github(db, org, project, owner)
    headers = auth_headers(client, owner.email)

    response = client.get(
        f"/api/v1/github/oauth/authorize?type=project&project_id={project.id}",
        headers=headers,
    )
    assert response.status_code == 200
    assert "github.com/login/oauth/authorize" in response.json()["url"]


@pytest.mark.integration
def test_project_connection_member_can_view_not_manage(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    from app.tests.helpers import add_project_member

    seed_project_github(db, org, project, owner)
    member = add_project_member(db, org, workspace, project, "gh-viewer@test.dev")
    headers = auth_headers(client, member.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert status.status_code == 200
    assert status.json()["connected"] is True
    assert status.json()["can_manage"] is False
    assert status.json()["can_connect"] is False
    assert status.json()["can_disconnect"] is False
    assert status.json()["can_link_repo"] is False


@pytest.mark.integration
def test_task_github_events_returns_404_for_missing_task(client, db, org, owner):
    from uuid import uuid4

    headers = auth_headers(client, owner.email)
    response = client.get(f"/api/v1/github/tasks/{uuid4()}/events", headers=headers)
    assert response.status_code == 404


def _github_conn(conn_type: str) -> GithubConnection:
    return GithubConnection(
        id=uuid4(),
        organization_id=uuid4(),
        user_id=uuid4(),
        connection_type=conn_type,
        access_token="sealed",
        scope="repo",
        github_user_login="dev-user",
        github_user_id=1,
        connected_by=uuid4(),
    )


@pytest.mark.integration
def test_acting_connections_orders_personal_then_project():
    personal = _github_conn(CONNECTION_PERSONAL)
    project = _github_conn(CONNECTION_PROJECT)
    repo = GithubRepository(
        id=uuid4(),
        connection_id=project.id,
        workspace_id=uuid4(),
        project_id=uuid4(),
        repo_id=1,
        repo_full_name="acme/app",
        is_active=True,
    )
    db = MagicMock()
    db.get.return_value = project
    db.scalar.return_value = None

    ordered = github_api._acting_connections_for_repo(db, personal=personal, repo=repo)
    assert ordered == [personal, project]


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_issue")
@patch("app.api.v1.github._github_token", return_value="token")
def test_create_issue_retries_project_token_after_personal_401(mock_token, mock_create):
    personal = _github_conn(CONNECTION_PERSONAL)
    project = _github_conn(CONNECTION_PROJECT)
    repo = GithubRepository(
        id=uuid4(),
        connection_id=project.id,
        workspace_id=uuid4(),
        project_id=uuid4(),
        repo_id=1,
        repo_full_name="acme/app",
        is_active=True,
    )
    db = MagicMock()
    db.get.return_value = project
    mock_create.side_effect = [
        gh_api.GitHubApiError(401, "expired"),
        {"number": 7, "html_url": "https://github.com/acme/app/issues/7"},
    ]

    issue, used_token = github_api._create_github_issue_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        owner="acme",
        repo_name="app",
        issue_title="Proj/Task",
        issue_body="body",
    )
    assert issue["number"] == 7
    assert used_token
    assert mock_create.call_count == 2


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_issue")
def test_create_issue_raises_401_when_all_tokens_invalid(mock_create):
    personal = _github_conn(CONNECTION_PERSONAL)
    repo = GithubRepository(
        id=uuid4(),
        connection_id=None,
        workspace_id=uuid4(),
        project_id=uuid4(),
        repo_id=1,
        repo_full_name="acme/app",
        is_active=True,
    )
    mock_create.side_effect = gh_api.GitHubApiError(401, "expired")
    db = MagicMock()
    db.get.return_value = None
    db.scalar.return_value = None

    with pytest.raises(HTTPException) as exc:
        github_api._create_github_issue_with_token_fallback(
            db,
            personal=personal,
            repo=repo,
            owner="acme",
            repo_name="app",
            issue_title="Proj/Task",
            issue_body="body",
        )
    assert exc.value.status_code == 401


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_branch")
@patch("app.api.v1.github._github_token", return_value="token")
def test_create_branch_retries_project_token_after_personal_401(mock_token, mock_branch):
    personal = _github_conn(CONNECTION_PERSONAL)
    project = _github_conn(CONNECTION_PROJECT)
    repo = GithubRepository(
        id=uuid4(),
        connection_id=project.id,
        workspace_id=uuid4(),
        project_id=uuid4(),
        repo_id=1,
        repo_full_name="acme/app",
        default_branch="main",
        is_active=True,
    )
    db = MagicMock()
    db.get.return_value = project
    mock_branch.side_effect = [
        gh_api.GitHubApiError(401, "expired"),
        "https://github.com/acme/app/tree/feature-x",
    ]

    url = github_api._github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=lambda token: gh_api.create_branch(
            token, "acme", "app", "feature-x", "main"
        ),
        failure_detail="Could not create branch on GitHub",
    )
    assert "feature-x" in url
    assert mock_branch.call_count == 2


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.open_pull_request_for_branch")
@patch("app.api.v1.github._github_token", return_value="token")
def test_create_pr_retries_project_token_after_personal_401(mock_token, mock_open_pr):
    personal = _github_conn(CONNECTION_PERSONAL)
    project = _github_conn(CONNECTION_PROJECT)
    repo = GithubRepository(
        id=uuid4(),
        connection_id=project.id,
        workspace_id=uuid4(),
        project_id=uuid4(),
        repo_id=1,
        repo_full_name="acme/app",
        default_branch="main",
        is_active=True,
    )
    db = MagicMock()
    db.get.return_value = project
    mock_open_pr.side_effect = [
        gh_api.GitHubApiError(401, "expired"),
        {"number": 3, "html_url": "https://github.com/acme/app/pull/3"},
    ]

    pr = github_api._github_action_with_token_fallback(
        db,
        personal=personal,
        repo=repo,
        action=lambda token: gh_api.open_pull_request_for_branch(
            token, "acme", "app", title="Fix", head="feature-x", base="main",
        ),
        failure_detail="Could not create pull request on GitHub",
    )
    assert pr["number"] == 3
    assert mock_open_pr.call_count == 2
