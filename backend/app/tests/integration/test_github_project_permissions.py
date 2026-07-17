"""Integration — GitHub project tab permissions (connect, link, disconnect, one-repo limit)."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import jwt
import pytest
import secrets

from app.core.config import settings
from app.models.github import CONNECTION_PROJECT, GithubConnection
from app.tests.conftest import auth_headers
from app.tests.helpers import (
    add_project_member,
    build_project_stack,
    seed_github_repo,
    seed_personal_github,
    seed_project_github,
)

_GH_OAUTH_COOKIE = "flowdesk_gh_oauth"


def _project_oauth_state(*, org_id, user_id, project_id):
    nonce = secrets.token_urlsafe(24)
    state = jwt.encode(
        {
            "type": CONNECTION_PROJECT,
            "org_id": str(org_id),
            "project_id": str(project_id),
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
def test_disconnected_project_admin_can_connect(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PCA")
    headers = auth_headers(client, owner.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    body = status.json()
    assert status.status_code == 200
    assert body["connected"] is False
    assert body["can_manage"] is True
    assert body["can_connect"] is True
    assert body["can_disconnect"] is False
    assert body["can_link_repo"] is False


@pytest.mark.integration
def test_disconnected_org_admin_without_project_row_can_connect(client, db, org, owner):
    """Org admins manage GitHub even when they are not explicit project_members rows."""
    workspace, project = build_project_stack(db, org, owner, project_key="OAC")
    from app.models.project import ProjectMember
    from sqlalchemy import delete

    db.execute(delete(ProjectMember).where(ProjectMember.project_id == project.id))
    db.flush()
    headers = auth_headers(client, owner.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    body = status.json()
    assert status.status_code == 200
    assert body["can_manage"] is True
    assert body["can_connect"] is True


@pytest.mark.integration
def test_disconnected_project_member_cannot_connect(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PCM")
    member = add_project_member(db, org, workspace, project, "gh-member@test.dev")
    headers = auth_headers(client, member.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    body = status.json()
    assert status.status_code == 200
    assert body["connected"] is False
    assert body["can_manage"] is False
    assert body["can_connect"] is False


@pytest.mark.integration
def test_connected_connector_can_link_repo_when_none_linked(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLK")
    seed_project_github(db, org, project, owner)
    headers = auth_headers(client, owner.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    body = status.json()
    assert body["connected"] is True
    assert body["can_disconnect"] is True
    assert body["can_link_repo"] is True
    assert body["connected_by"] == str(owner.id)


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues", return_value=[])
def test_relink_repo_after_unlink_on_project_connection(
    mock_list_issues, mock_get_repo, mock_hook, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="RLK")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, repo_full_name="acme/first", repo_id=88010)
    mock_get_repo.return_value = {"id": 88011, "default_branch": "main"}
    mock_hook.return_value = 88012
    headers = auth_headers(client, owner.email)

    assert client.delete(f"/api/v1/github/repositories/{repo.id}", headers=headers).status_code == 200

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert status.json()["can_link_repo"] is True

    relink = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/second"},
    )
    assert relink.status_code == 201
    assert relink.json()["repo_full_name"] == "acme/second"


@pytest.mark.integration
def test_connect_personal_repo_blocked_when_project_connection_exists(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PBL")
    seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    headers = auth_headers(client, owner.email)

    resp = client.post(
        f"/api/v1/github/organizations/{org.id}/personal-connection/connect-repo",
        headers=headers,
        json={"project_id": str(project.id), "repo_full_name": "dev-user/alpha"},
    )
    assert resp.status_code == 409
    assert "Project tab" in resp.json()["detail"]


@pytest.mark.integration
def test_connect_personal_repo_allowed_after_project_connection_removed(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PCG")
    seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    headers = auth_headers(client, owner.email)

    assert client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=headers).status_code == 200

    with patch("app.api.v1.github.github_api_service.create_webhook", return_value=1), \
         patch("app.api.v1.github.github_api_service.get_repo", return_value={"id": 1, "default_branch": "main"}), \
         patch("app.services.github_api_service.list_open_issues", return_value=[]):
        resp = client.post(
            f"/api/v1/github/organizations/{org.id}/personal-connection/connect-repo",
            headers=headers,
            json={"project_id": str(project.id), "repo_full_name": "dev-user/alpha"},
        )
    assert resp.status_code == 201


@pytest.mark.integration
def test_connected_connector_cannot_link_when_repo_exists(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLX")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, connected_by=owner.id)
    headers = auth_headers(client, owner.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    body = status.json()
    assert body["can_link_repo"] is False


@pytest.mark.integration
def test_connected_other_admin_has_no_connect_link_or_disconnect(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="OAD")
    other_admin = add_project_member(db, org, workspace, project, "other-admin@test.dev", role="admin")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, connected_by=owner.id)
    headers = auth_headers(client, other_admin.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    body = status.json()
    assert body["connected"] is True
    assert body["can_manage"] is True
    assert body["can_connect"] is False
    assert body["can_disconnect"] is False
    assert body["can_link_repo"] is False


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.list_accessible_repos")
def test_available_repos_denied_for_non_connector_admin(mock_list, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ARD")
    other_admin = add_project_member(db, org, workspace, project, "repos-deny@test.dev", role="admin")
    seed_project_github(db, org, project, owner)
    headers = auth_headers(client, other_admin.email)

    response = client.get(f"/api/v1/github/projects/{project.id}/available-repos", headers=headers)
    assert response.status_code == 403
    mock_list.assert_not_called()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.list_accessible_repos")
def test_available_repos_denied_when_repo_already_linked(mock_list, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ARL")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn, connected_by=owner.id)
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/github/projects/{project.id}/available-repos", headers=headers)
    assert response.status_code == 409
    mock_list.assert_not_called()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues", return_value=[])
def test_personal_connect_blocked_when_project_github_exists(
    mock_list_issues, mock_get_repo, mock_webhook, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="PBL")
    seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    mock_get_repo.return_value = {"id": 42, "default_branch": "main"}
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/organizations/{org.id}/personal-connection/connect-repo",
        headers=headers,
        json={"project_id": str(project.id), "repo_full_name": "dev-user/bypass"},
    )
    assert response.status_code == 409
    mock_webhook.assert_not_called()


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.delete_webhook")
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues", return_value=[])
def test_admin_handoff_after_unlink_and_disconnect(
    mock_list_issues, mock_get_repo, mock_hook, mock_delete, client, db, org, owner, monkeypatch
):
    """Connector unlinks + disconnects; another project admin can then connect and link."""
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    workspace, project = build_project_stack(db, org, owner, project_key="HND")
    successor = add_project_member(db, org, workspace, project, "successor-admin@test.dev", role="admin")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, connected_by=owner.id, webhook_hook_id=55)
    owner_headers = auth_headers(client, owner.email)

    unlink = client.delete(f"/api/v1/github/repositories/{repo.id}", headers=owner_headers)
    assert unlink.status_code == 200

    disconnect = client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=owner_headers)
    assert disconnect.status_code == 200

    successor_headers = auth_headers(client, successor.email)
    before = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=successor_headers)
    assert before.json()["can_connect"] is True

    oauth = client.get(
        "/api/v1/github/oauth/authorize",
        headers=successor_headers,
        params={"type": "project", "project_id": str(project.id)},
    )
    assert oauth.status_code == 200

    mock_get_repo.return_value = {"id": 9001, "default_branch": "main"}
    mock_hook.return_value = 77
    seed_project_github(db, org, project, successor, github_user_login="successor-bot")

    link = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=successor_headers,
        json={"repo_full_name": "acme/handoff"},
    )
    assert link.status_code == 201
    assert link.json()["connected_by"] == str(successor.id)
    assert link.json()["repo_full_name"] == "acme/handoff"

    owner_headers = auth_headers(client, owner.email)
    owner_status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=owner_headers)
    assert owner_status.json()["can_disconnect"] is False
    assert owner_status.json()["can_link_repo"] is False

    repo_id = link.json()["id"]
    owner_unlink = client.delete(f"/api/v1/github/repositories/{repo_id}", headers=owner_headers)
    assert owner_unlink.status_code == 403

    owner_disconnect = client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=owner_headers)
    assert owner_disconnect.status_code == 403


@pytest.mark.integration
def test_other_admin_cannot_unlink_or_disconnect_while_connector_active(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="BLK")
    other_admin = add_project_member(db, org, workspace, project, "blocker-admin@test.dev", role="admin")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, connected_by=owner.id)
    headers = auth_headers(client, other_admin.email)

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    body = status.json()
    assert body["connected"] is True
    assert body["can_connect"] is False
    assert body["can_disconnect"] is False
    assert body["can_link_repo"] is False

    unlink = client.delete(f"/api/v1/github/repositories/{repo.id}", headers=headers)
    assert unlink.status_code == 403

    disconnect = client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert disconnect.status_code == 403


@pytest.mark.integration
def test_other_admin_cannot_unlink_when_repo_missing_connected_by(client, db, org, owner):
    """Legacy rows without repo.connected_by still belong to the connector only."""
    workspace, project = build_project_stack(db, org, owner, project_key="LGC")
    other_admin = add_project_member(db, org, workspace, project, "legacy-block@test.dev", role="admin")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, connected_by=None)
    headers = auth_headers(client, other_admin.email)

    denied = client.delete(f"/api/v1/github/repositories/{repo.id}", headers=headers)
    assert denied.status_code == 403

    allowed = client.delete(
        f"/api/v1/github/repositories/{repo.id}",
        headers=auth_headers(client, owner.email),
    )
    assert allowed.status_code == 200


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.get_authenticated_user")
@patch("app.api.v1.github.http_requests.post")
def test_oauth_callback_rejects_project_hijack_by_other_admin(
    mock_post, mock_gh_user, client, db, org, owner, monkeypatch
):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_SECRET", "gh-secret")
    workspace, project = build_project_stack(db, org, owner, project_key="HJK")
    intruder = add_project_member(db, org, workspace, project, "intruder@test.dev", role="admin")
    seed_project_github(db, org, project, owner, github_user_login="owner-bot")

    state, nonce = _project_oauth_state(org_id=org.id, user_id=intruder.id, project_id=project.id)
    mock_post.return_value = MagicMock(
        raise_for_status=lambda: None,
        json=lambda: {"access_token": "evil-token", "scope": "repo"},
    )
    mock_gh_user.return_value = {"login": "intruder-bot", "id": 666}

    response = client.get(
        "/api/v1/github/oauth/callback",
        params={"code": "oauth-code", "state": state},
        cookies={_GH_OAUTH_COOKIE: nonce},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "github_error=1" in response.headers["location"]

    from sqlalchemy import select

    row = db.scalar(
        select(GithubConnection).where(
            GithubConnection.project_id == project.id,
            GithubConnection.connection_type == CONNECTION_PROJECT,
        )
    )
    assert row is not None
    assert row.github_user_login == "owner-bot"
    assert row.connected_by == owner.id


@pytest.mark.integration
def test_project_member_cannot_connect_repo_or_oauth(client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.github.settings.GITHUB_CLIENT_ID", "gh-client-id")
    workspace, project = build_project_stack(db, org, owner, project_key="MBR")
    member = add_project_member(db, org, workspace, project, "plain-member@test.dev")
    headers = auth_headers(client, member.email)

    oauth = client.get(
        "/api/v1/github/oauth/authorize",
        headers=headers,
        params={"type": "project", "project_id": str(project.id)},
    )
    assert oauth.status_code == 403

    connect = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/app"},
    )
    assert connect.status_code == 403


@pytest.mark.integration
@patch("app.api.v1.github.github_api_service.create_webhook")
@patch("app.api.v1.github.github_api_service.get_repo")
@patch("app.services.github_api_service.list_open_issues", return_value=[])
def test_connect_repo_records_connected_by(mock_list_issues, mock_get_repo, mock_hook, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CBY")
    seed_project_github(db, org, project, owner)
    mock_get_repo.return_value = {"id": 501, "default_branch": "main"}
    mock_hook.return_value = 502
    headers = auth_headers(client, owner.email)

    created = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/tracked"},
    )
    assert created.status_code == 201
    assert created.json()["connected_by"] == str(owner.id)

    listed = client.get(f"/api/v1/github/projects/{project.id}/repositories", headers=headers)
    assert listed.json()[0]["connected_by"] == str(owner.id)


@pytest.mark.integration
def test_connector_owner_can_disconnect_after_repo_unlinked(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="DCN")
    conn = seed_project_github(db, org, project, owner)
    repo = seed_github_repo(db, workspace, project, conn, connected_by=owner.id)
    headers = auth_headers(client, owner.email)

    client.delete(f"/api/v1/github/repositories/{repo.id}", headers=headers)
    response = client.delete(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert response.status_code == 200

    status = client.get(f"/api/v1/github/projects/{project.id}/connection", headers=headers)
    assert status.json()["connected"] is False


@pytest.mark.integration
def test_project_github_events_only_from_active_linked_repo(client, db, org, owner):
    """After unlinking one repo and linking another, the GitHub tab shows only the current repo."""
    from app.models.github import GithubEvent

    workspace, project = build_project_stack(db, org, owner, project_key="EVA")
    conn = seed_project_github(db, org, project, owner)
    old_repo = seed_github_repo(
        db, workspace, project, conn, repo_full_name="yanthraa-information-systems/flowdesk_API", repo_id=88001,
    )
    db.add(
        GithubEvent(
            repository_id=old_repo.id,
            event_type="issues",
            action="imported",
            actor_login="ksrinivas-ops",
            payload={
                "summary": "Issue #40 imported → task PW-4 created",
                "repo": old_repo.repo_full_name,
            },
        )
    )
    old_repo.is_active = False

    new_repo = seed_github_repo(
        db, workspace, project, conn, repo_full_name="Jahnavigajjela213/estate-chain", repo_id=88002,
    )
    db.add(
        GithubEvent(
            repository_id=new_repo.id,
            event_type="issues",
            action="imported",
            actor_login="Jahnavigajjela213",
            payload={
                "summary": "Issue #1 imported → task PW-5 created",
                "repo": new_repo.repo_full_name,
            },
        )
    )
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/github/projects/{project.id}/events", headers=headers)
    body = response.json()
    assert response.status_code == 200
    assert body["total"] == 1
    assert body["items"][0]["payload"]["repo"] == new_repo.repo_full_name
