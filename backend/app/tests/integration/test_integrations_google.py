"""Integration — Google Sheets export/sync, task emails, calendar events (mocked I/O)."""
from unittest.mock import patch

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack, seed_google_connection


@pytest.mark.integration
@patch("app.services.google_service.sheets_overwrite")
@patch("app.services.google_service.sheets_create")
def test_export_project_to_sheet(mock_create, mock_overwrite, client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")
    seed_google_connection(db, owner)
    workspace, project = build_project_stack(db, org, owner, project_key="EXP")
    add_task(db, project, owner, title="Export me", number=1)
    mock_create.return_value = ("sheet-id", "https://sheets/export")

    headers = auth_headers(client, owner.email)
    response = client.post(f"/api/v1/projects/{project.id}/sheets/export", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["url"] == "https://sheets/export"
    mock_overwrite.assert_called_once()


@pytest.mark.integration
@patch("app.api.v1.integrations.run_sync")
@patch("app.services.google_service.sheets_create")
def test_toggle_sheet_sync_enables_export(mock_create, mock_run_sync, client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")
    seed_google_connection(db, owner)
    workspace, project = build_project_stack(db, org, owner)
    mock_create.return_value = ("sync-sheet", "https://sheets/sync")
    mock_run_sync.return_value = True

    headers = auth_headers(client, owner.email)
    response = client.post(
        f"/api/v1/projects/{project.id}/sheets/sync",
        headers=headers,
        json={"enabled": True, "mode": "export"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["enabled"] is True
    assert response.json()["mode"] == "export"
    mock_run_sync.assert_called_once()


@pytest.mark.integration
@patch("app.services.google_service.gmail_search")
def test_task_emails_endpoint(mock_search, client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")
    seed_google_connection(db, owner)
    workspace, project = build_project_stack(db, org, owner, project_key="EML")
    task = add_task(db, project, owner, title="Email task", number=4)
    mock_search.return_value = [
        {
            "id": "m1",
            "subject": "EML-4 discussion",
            "sender": "dev@test.dev",
            "date": "Mon",
            "snippet": "notes",
            "link": "https://mail/1",
        }
    ]

    headers = auth_headers(client, owner.email)
    response = client.get(f"/api/v1/tasks/{task.id}/emails", headers=headers)
    assert response.status_code == 200
    assert response.json()["connected"] is True
    assert response.json()["emails"][0]["subject"] == "EML-4 discussion"


@pytest.mark.integration
@patch("app.services.google_service.calendar_create_event")
def test_add_task_to_calendar(mock_create_event, client, db, org, owner, monkeypatch):
    from datetime import date

    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")
    seed_google_connection(db, owner)
    workspace, project = build_project_stack(db, org, owner, project_key="CAL")
    task = add_task(db, project, owner, title="Due task", number=2)
    task.due_date = date.today()
    db.flush()
    mock_create_event.return_value = {"id": "evt-99", "link": "https://calendar/99"}

    headers = auth_headers(client, owner.email)
    response = client.post(f"/api/v1/tasks/{task.id}/calendar-event", headers=headers)
    assert response.status_code == 200
    assert response.json()["link"] == "https://calendar/99"
    assert task.google_calendar_event_id == "evt-99"
