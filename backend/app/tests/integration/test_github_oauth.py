"""Integration — GitHub OAuth authorize and callback (mocked GitHub API)."""
import secrets
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import jwt
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.github import CONNECTION_PERSONAL, GithubConnection
from app.tests.conftest import auth_headers
from app.tests.helpers import build_project_stack


_GH_OAUTH_COOKIE = "flowdesk_gh_oauth"


def _github_oauth_state(*, org_id, user_id, conn_type: str = CONNECTION_PERSONAL, project_id=None):
    nonce = secrets.token_urlsafe(24)
    state = jwt.encode(
        {
            "type": conn_type,
            "org_id": str(org_id),
            "project_id": str(project_id) if project_id else None,
            "user_id": str(user_id),
            "next": "apps",
            "nonce": nonce,
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        settings.SECRET_KEY,
        algorithm="HS256",
    )
    return state, nonce


@pytest.mark.integration
def test_github_oauth_authorize_personal(client, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    headers = auth_headers(client, owner.email)

    response = client.get(
        f"/api/v1/github/oauth/authorize?type=personal&org_id={org.id}",
        headers=headers,
    )
    assert response.status_code == 200
    assert "github.com/login/oauth/authorize" in response.json()["url"]


@pytest.mark.integration
def test_github_oauth_authorize_project(client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.get(
        f"/api/v1/github/oauth/authorize?type=project&project_id={project.id}",
        headers=headers,
    )
    assert response.status_code == 200
    assert "scope=repo" in response.json()["url"]


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.get_authenticated_user")
@patch("app.api.v1.github.http_requests.post")
def test_github_oauth_callback_personal(mock_post, mock_gh_user, client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_SECRET", "gh-secret")
    state, nonce = _github_oauth_state(org_id=org.id, user_id=owner.id)

    mock_post.return_value = MagicMock(
        raise_for_status=lambda: None,
        json=lambda: {"access_token": "gh-access-token", "scope": "repo"},
    )
    mock_gh_user.return_value = {"login": "dev-user", "id": 4242}

    response = client.get(
        "/api/v1/github/oauth/callback",
        params={"code": "oauth-code", "state": state},
        cookies={_GH_OAUTH_COOKIE: nonce},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "github_connected=1" in response.headers["location"]

    conn = db.scalar(
        select(GithubConnection).where(
            GithubConnection.organization_id == org.id,
            GithubConnection.user_id == owner.id,
            GithubConnection.connection_type == CONNECTION_PERSONAL,
        )
    )
    assert conn is not None
    assert conn.github_user_login == "dev-user"


@pytest.mark.integration
def test_github_oauth_callback_rejects_missing_cookie(client, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    state, _nonce = _github_oauth_state(org_id=org.id, user_id=owner.id)

    response = client.get(
        "/api/v1/github/oauth/callback",
        params={"code": "oauth-code", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "github_error=1" in response.headers["location"]
