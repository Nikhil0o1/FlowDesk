"""Unit tests — Google Sheets, Gmail, and Calendar HTTP clients (mocked)."""
from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from app.services import google_service
from app.tests.helpers import seed_google_connection


@pytest.mark.unit
@patch("app.services.google_service.http.put")
@patch("app.services.google_service.http.post")
def test_sheets_create_and_overwrite(mock_post, mock_put, db, owner):
    conn = seed_google_connection(db, owner)
    create_resp = MagicMock(ok=True, json=lambda: {"spreadsheetId": "sheet-123", "spreadsheetUrl": "https://sheets/123"})
    clear_resp = MagicMock(ok=True)
    write_resp = MagicMock(ok=True)
    mock_post.side_effect = [create_resp, clear_resp]
    mock_put.return_value = write_resp

    spreadsheet_id, url = google_service.sheets_create(db, conn, "Export")
    assert spreadsheet_id == "sheet-123"
    assert url == "https://sheets/123"

    google_service.sheets_overwrite(db, conn, spreadsheet_id, [["Ref", "Title"], ["P-1", "Task"]])
    assert mock_post.call_count == 2
    mock_put.assert_called_once()


@pytest.mark.unit
@patch("app.services.google_service.http.get")
def test_sheets_read_returns_values(mock_get, db, owner):
    conn = seed_google_connection(db, owner)
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"values": [["Ref"], ["P-1"]]})

    rows = google_service.sheets_read(db, conn, "sheet-123")
    assert rows == [["Ref"], ["P-1"]]


@pytest.mark.unit
@patch("app.services.google_service.http.get")
def test_gmail_search_returns_metadata(mock_get, db, owner):
    conn = seed_google_connection(db, owner)
    mock_get.side_effect = [
        MagicMock(ok=True, json=lambda: {"messages": [{"id": "msg-1"}]}),
        MagicMock(
            ok=True,
            json=lambda: {
                "id": "msg-1",
                "snippet": "PHX-12 update",
                "payload": {
                    "headers": [
                        {"name": "Subject", "value": "Re: PHX-12"},
                        {"name": "From", "value": "dev@test.dev"},
                        {"name": "Date", "value": "Mon"},
                    ]
                },
            },
        ),
    ]

    results = google_service.gmail_search(db, conn, "PHX-12", limit=5)
    assert len(results) == 1
    assert results[0]["subject"] == "Re: PHX-12"


@pytest.mark.unit
@patch("app.services.google_service.http.post")
def test_calendar_create_event(mock_post, db, owner):
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(
        ok=True,
        json=lambda: {"id": "evt-1", "htmlLink": "https://calendar/evt-1"},
    )

    result = google_service.calendar_create_event(
        db, conn, summary="PRJ-1: Ship", description="Task link", day=date.today()
    )
    assert result["id"] == "evt-1"
    assert "calendar" in result["link"]


@pytest.mark.unit
@patch("app.services.google_service.http.post")
def test_try_gmail_send_success(mock_post, db, owner, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.EMAIL_FROM", "no-reply@flowdesk.test")
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True)

    assert google_service.try_gmail_send(db, owner.id, "to@test.dev", "Hello", "<p>Hi</p>") is True


@pytest.mark.unit
@patch("app.services.google_service.http.put")
def test_sheets_write(mock_put, db, owner):
    conn = seed_google_connection(db, owner)
    mock_put.return_value = MagicMock(ok=True)

    google_service.sheets_write(db, conn, "sheet-456", "Entries!A1", [["A", "B"], [1, 2]])
    mock_put.assert_called_once()


@pytest.mark.unit
@patch("app.services.google_service.http.post")
def test_calendar_create_timed_event_with_meet(mock_post, db, owner):
    from datetime import datetime, timedelta, timezone

    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(
        ok=True,
        json=lambda: {
            "id": "evt-timed",
            "htmlLink": "https://calendar.google.com/evt-timed",
            "hangoutLink": "https://meet.google.com/abc",
        },
    )
    start = datetime.now(timezone.utc) + timedelta(hours=1)
    end = start + timedelta(hours=1)

    result = google_service.calendar_create_timed_event(
        db,
        conn,
        summary="Sprint planning",
        description="Agenda",
        start_at=start,
        end_at=end,
        add_meet=True,
    )
    assert result["id"] == "evt-timed"
    assert result.get("meet_link")
