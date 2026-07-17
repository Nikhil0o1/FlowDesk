"""Coverage — GitHub legacy installations, webhook ping, and error paths."""
import hashlib
import hmac
import json
from unittest.mock import patch

import pytest

from app.core.config import settings
from app.models.github import GithubInstallation
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack, seed_project_github


def _sign(payload: bytes) -> str:
    secret = settings.GITHUB_WEBHOOK_SECRET or "flowdesk-dev"
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


@pytest.mark.coverage
def test_github_webhook_ping(client, db, monkeypatch):
    class _DbProxy:
        def __init__(self, session):
            self._session = session

        def __getattr__(self, name):
            return getattr(self._session, name)

        def close(self):
            pass

    monkeypatch.setattr("app.db.session.SessionLocal", lambda: _DbProxy(db))
    payload = json.dumps({"zen": "Keep it pragmatic"}).encode()
    response = client.post(
        "/api/v1/github/webhook",
        content=payload,
        headers={
            "X-GitHub-Event": "ping",
            "X-GitHub-Delivery": "ping-1",
            "X-Hub-Signature-256": _sign(payload),
            "Content-Type": "application/json",
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True


@pytest.mark.coverage
def test_github_register_and_list_installations(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    created = client.post(
        f"/api/v1/github/organizations/{org.id}/installations",
        headers=headers,
        json={
            "installation_id": 424242,
            "account_login": "acme-org",
            "account_type": "Organization",
        },
    )
    assert created.status_code == 201
    inst_id = created.json()["id"]

    listed = client.get(f"/api/v1/github/organizations/{org.id}/installations", headers=headers)
    assert listed.status_code == 200
    assert any(i["id"] == inst_id for i in listed.json())

    dup = client.post(
        f"/api/v1/github/organizations/{org.id}/installations",
        headers=headers,
        json={
            "installation_id": 424242,
            "account_login": "acme-org",
            "account_type": "Organization",
        },
    )
    assert dup.status_code == 409


@pytest.mark.coverage
def test_github_legacy_connect_repository(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="LEG")
    inst = GithubInstallation(
        organization_id=org.id,
        installation_id=777888,
        account_login="legacy-org",
        account_type="Organization",
        installed_by=owner.id,
    )
    db.add(inst)
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        "/api/v1/github/repositories",
        headers=headers,
        json={
            "installation_id": str(inst.id),
            "project_id": str(project.id),
            "repo_id": 123456,
            "repo_full_name": "legacy-org/service",
            "default_branch": "main",
        },
    )
    assert response.status_code == 201
    assert response.json()["repo_full_name"] == "legacy-org/service"


@pytest.mark.coverage
def test_github_legacy_connect_repository_via_workspace(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner, project_key="WS")
    inst = GithubInstallation(
        organization_id=org.id,
        installation_id=777889,
        account_login="legacy-ws",
        account_type="Organization",
        installed_by=owner.id,
    )
    db.add(inst)
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        "/api/v1/github/repositories",
        headers=headers,
        json={
            "installation_id": str(inst.id),
            "workspace_id": str(workspace.id),
            "repo_id": 123457,
            "repo_full_name": "legacy-ws/monorepo",
            "default_branch": "main",
        },
    )
    assert response.status_code == 201
    assert response.json()["repo_full_name"] == "legacy-ws/monorepo"


@pytest.mark.coverage
def test_github_legacy_connect_repository_rejects_org_mismatch(client, db, org, owner):
    from app.models.organization import Organization, OrganizationMember

    other_org = Organization(name="Other Org")
    db.add(other_org)
    db.flush()
    db.add(OrganizationMember(organization_id=other_org.id, user_id=owner.id, role="owner"))
    _workspace, other_project = build_project_stack(db, other_org, owner, project_key="MIS")
    inst = GithubInstallation(
        organization_id=org.id,
        installation_id=777890,
        account_login="legacy-org",
        account_type="Organization",
        installed_by=owner.id,
    )
    db.add(inst)
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        "/api/v1/github/repositories",
        headers=headers,
        json={
            "installation_id": str(inst.id),
            "project_id": str(other_project.id),
            "repo_id": 123458,
            "repo_full_name": "legacy-org/app",
            "default_branch": "main",
        },
    )
    assert response.status_code == 403


@pytest.mark.coverage
def test_github_legacy_connect_repository_missing_installation(client, db, org, owner):
    from uuid import uuid4

    workspace, project = build_project_stack(db, org, owner, project_key="NOINST")
    headers = auth_headers(client, owner.email)

    response = client.post(
        "/api/v1/github/repositories",
        headers=headers,
        json={
            "installation_id": str(uuid4()),
            "project_id": str(project.id),
            "repo_id": 123461,
            "repo_full_name": "legacy-org/missing",
            "default_branch": "main",
        },
    )
    assert response.status_code == 404


@pytest.mark.coverage
def test_github_legacy_connect_repository_requires_target(client, db, org, owner):
    inst = GithubInstallation(
        organization_id=org.id,
        installation_id=777891,
        account_login="legacy-org",
        account_type="Organization",
        installed_by=owner.id,
    )
    db.add(inst)
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        "/api/v1/github/repositories",
        headers=headers,
        json={
            "installation_id": str(inst.id),
            "repo_id": 123459,
            "repo_full_name": "legacy-org/orphan",
            "default_branch": "main",
        },
    )
    assert response.status_code == 422


@pytest.mark.coverage
def test_github_legacy_connect_workspace_rejects_org_mismatch(client, db, org, owner):
    from app.models.organization import Organization, OrganizationMember

    other_org = Organization(name="Other Org WS")
    db.add(other_org)
    db.flush()
    db.add(OrganizationMember(organization_id=other_org.id, user_id=owner.id, role="owner"))
    other_workspace, _ = build_project_stack(db, other_org, owner, project_key="OWS")
    inst = GithubInstallation(
        organization_id=org.id,
        installation_id=777892,
        account_login="legacy-org",
        account_type="Organization",
        installed_by=owner.id,
    )
    db.add(inst)
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        "/api/v1/github/repositories",
        headers=headers,
        json={
            "installation_id": str(inst.id),
            "workspace_id": str(other_workspace.id),
            "repo_id": 123460,
            "repo_full_name": "legacy-org/ws-app",
            "default_branch": "main",
        },
    )
    assert response.status_code == 403


@pytest.mark.coverage
@patch("app.api.v1.github.reveal", return_value=None)
def test_github_invalid_token_returns_401(_mock, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_project_github(db, org, project, owner)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/github/projects/{project.id}/connect-repo",
        headers=headers,
        json={"repo_full_name": "acme/app"},
    )
    assert response.status_code == 401


@pytest.mark.coverage
@patch("app.api.v1.github.github_api_service.list_accessible_repos", side_effect=RuntimeError("gh down"))
def test_github_available_repos_502(_mock, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_project_github(db, org, project, owner)
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/github/projects/{project.id}/available-repos", headers=headers)
    assert response.status_code == 502


@pytest.mark.coverage
def test_github_connected_search_disabled(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    seed_project_github(db, org, project, owner, connected_search_enabled=False)
    headers = auth_headers(client, owner.email)

    response = client.get(
        f"/api/v1/github/projects/{project.id}/search",
        headers=headers,
        params={"q": "foo"},
    )
    assert response.status_code == 200
    assert response.json()["connected"] is False
