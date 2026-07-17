"""Coverage — sheet sync toggle off and Gmail connect status."""
from unittest.mock import patch

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack, seed_google_connection


@pytest.mark.coverage
@patch("app.api.v1.integrations.run_sync")
@patch("app.services.google_service.sheets_create")
def test_sheet_sync_disable_toggle(mock_create, mock_run_sync, client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")
    seed_google_connection(db, owner)
    workspace, project = build_project_stack(db, org, owner)
    mock_create.return_value = ("sync-off", "https://sheets/off")
    mock_run_sync.return_value = True
    headers = auth_headers(client, owner.email)

    client.post(
        f"/api/v1/projects/{project.id}/sheets/sync",
        headers=headers,
        json={"enabled": True, "mode": "export"},
    )
    off = client.post(
        f"/api/v1/projects/{project.id}/sheets/sync",
        headers=headers,
        json={"enabled": False},
    )
    assert off.status_code == 200
    assert off.json()["enabled"] is False

    status = client.get(f"/api/v1/projects/{project.id}/sheets/sync", headers=headers)
    assert status.json()["enabled"] is False


@pytest.mark.coverage
def test_gmail_status_disconnected_on_task_emails(client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")
    workspace, project = build_project_stack(db, org, owner, project_key="GML")
    task = add_task(db, project, owner, title="No gmail", number=7)
    headers = auth_headers(client, owner.email)

    response = client.get(f"/api/v1/tasks/{task.id}/emails", headers=headers)
    assert response.status_code == 200
    assert response.json()["connected"] is False
    assert response.json()["emails"] == []


@pytest.mark.coverage
@patch("app.services.google_service.gmail_search")
def test_gmail_connected_task_emails(mock_search, client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")
    seed_google_connection(db, owner)
    workspace, project = build_project_stack(db, org, owner, project_key="GM2")
    task = add_task(db, project, owner, title="Has gmail", number=8)
    mock_search.return_value = []
    headers = auth_headers(client, owner.email)

    google = client.get("/api/v1/integrations/google/status", headers=headers)
    assert google.json()["connected"] is True

    emails = client.get(f"/api/v1/tasks/{task.id}/emails", headers=headers)
    assert emails.json()["connected"] is True
