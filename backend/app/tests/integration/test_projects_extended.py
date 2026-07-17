"""Integration — project invites and activity feed."""
from unittest.mock import patch

import pytest

from app.services.activity_service import log_activity
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


@pytest.mark.integration
@patch("app.services.invite_service.email_service")
def test_project_admin_can_create_project_invite(mock_email, client, db, org, owner):
    """Project admin (workspace member, not ws admin) may invite to their project."""
    workspace, project = build_project_stack(db, org, owner)
    project_admin = add_project_member(
        db, org, workspace, project, "proj-admin@test.dev", role="admin"
    )
    headers = auth_headers(client, project_admin.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/invites",
        headers=headers,
        json={"email": "invited-by-proj-admin@test.dev", "role": "member"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["email"] == "invited-by-proj-admin@test.dev"
    assert response.json()["scope"] == "project"


@pytest.mark.integration
@patch("app.services.invite_service.email_service")
def test_project_member_cannot_create_project_invite(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "proj-member@test.dev", role="member")
    headers = auth_headers(client, member.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/invites",
        headers=headers,
        json={"email": "blocked@test.dev", "role": "member"},
    )
    assert response.status_code == 403


@pytest.mark.integration
@patch("app.services.invite_service.email_service")
def test_project_invite_create(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/invites",
        headers=headers,
        json={"email": "project-invite@test.dev", "role": "member"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["email"] == "project-invite@test.dev"
    assert response.json()["scope"] == "project"


@pytest.mark.integration
def test_project_activity_feed(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    log_activity(
        db,
        workspace_id=workspace.id,
        project_id=project.id,
        actor_id=owner.id,
        action="project.updated",
        data={"name": project.name},
    )
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/projects/{project.id}/activity", headers=headers)
    assert response.status_code == 200
    assert response.json()["total"] >= 1
    assert response.json()["items"][0]["action"] == "project.updated"
