"""Integration — Google Calendar API routes."""
from unittest.mock import MagicMock, patch

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import seed_google_connection


@pytest.mark.integration
def test_calendar_status_disconnected(client, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/calendar/status", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["google"]["configured"] is True
    assert data["google"]["connected"] is False
    assert data["outlook"]["configured"] is False


@pytest.mark.integration
def test_calendar_google_auth_url(client, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/calendar/google/auth-url", headers=headers)
    assert response.status_code == 200
    assert "accounts.google.com" in response.json()["url"]


@pytest.mark.integration
def test_calendar_status_connected(client, owner, db, monkeypatch):
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    seed_google_connection(db, owner)
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/calendar/status", headers=headers)
    assert response.status_code == 200
    assert response.json()["google"]["connected"] is True


@pytest.mark.integration
@patch("app.api.v1.calendar.http.get")
@patch("app.api.v1.calendar.http.post")
def test_google_callback_connect_all_partial_gmail_only(mock_post, mock_get, client, owner, db, monkeypatch):
    from app.api.v1.calendar import _state_token
    from app.models.calendar import CalendarConnection
    from app.services import google_service
    from sqlalchemy import select

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    state = _state_token(owner.id, "apps", "all")

    mock_post.return_value = MagicMock(
        ok=True,
        json=lambda: {
            "access_token": "cal-access",
            "refresh_token": "cal-refresh",
            "expires_in": 3600,
            # Granular consent often omits scope on the token body
        },
    )
    mock_get.side_effect = [
        MagicMock(ok=True, json=lambda: {"email": owner.email}),
        MagicMock(
            ok=True,
            json=lambda: {
                "scope": f"{google_service.SCOPE_GMAIL_SEND} {google_service.SCOPE_GMAIL_READ} email",
            },
        ),
    ]

    response = client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    location = response.headers["location"]
    assert "tools=gmail" in location

    conn = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == owner.id, CalendarConnection.provider == "google"
        )
    )
    assert conn is not None
    assert google_service.tool_is_connected(conn, "gmail")
    assert not google_service.tool_is_connected(conn, "calendar")
    assert not google_service.tool_is_connected(conn, "sheets")


@pytest.mark.integration
@patch("app.api.v1.calendar.http.get")
@patch("app.api.v1.calendar.http.post")
def test_google_callback_connect_all_stores_all_tool_scopes(mock_post, mock_get, client, owner, db, monkeypatch):
    from app.api.v1.calendar import _state_token
    from app.models.calendar import CalendarConnection
    from app.services import google_service
    from sqlalchemy import select

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    state = _state_token(owner.id, "apps", "all")

    mock_post.return_value = MagicMock(
        ok=True,
        json=lambda: {
            "access_token": "cal-access",
            "refresh_token": "cal-refresh",
            "expires_in": 3600,
            "scope": google_service.ALL_SCOPES,
        },
    )
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"email": owner.email})

    response = client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "tool=all" in response.headers["location"] or "tools=" in response.headers["location"]

    conn = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == owner.id, CalendarConnection.provider == "google"
        )
    )
    assert conn is not None
    assert google_service.all_tools_connected(conn)


@pytest.mark.integration
@patch("app.api.v1.calendar.http.get")
@patch("app.api.v1.calendar.http.post")
def test_google_callback_stores_only_requested_tool_scopes(mock_post, mock_get, client, owner, db, monkeypatch):
    from app.api.v1.calendar import _state_token
    from app.models.calendar import CalendarConnection
    from app.services import google_service
    from sqlalchemy import select

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    state = _state_token(owner.id, "apps", "gmail")

    mock_post.return_value = MagicMock(
        ok=True,
        json=lambda: {
            "access_token": "cal-access",
            "refresh_token": "cal-refresh",
            "expires_in": 3600,
            "scope": " ".join([
                google_service.SCOPE_CALENDAR,
                google_service.SCOPE_GMAIL_SEND,
                google_service.SCOPE_GMAIL_READ,
                google_service.SCOPE_SHEETS,
                "email",
            ]),
        },
    )
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"email": owner.email})

    response = client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "tool=gmail" in response.headers["location"]

    conn = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == owner.id, CalendarConnection.provider == "google"
        )
    )
    assert conn is not None
    assert google_service.tool_is_connected(conn, "gmail")
    assert not google_service.tool_is_connected(conn, "calendar")
    assert not google_service.tool_is_connected(conn, "sheets")


@pytest.mark.integration
@patch("app.api.v1.calendar.http.get")
@patch("app.api.v1.calendar.http.post")
def test_google_calendar_callback_creates_connection(mock_post, mock_get, client, owner, db, monkeypatch):
    from app.api.v1.calendar import _state_token
    from app.models.calendar import CalendarConnection
    from sqlalchemy import select

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    state = _state_token(owner.id, "planner")

    mock_post.return_value = MagicMock(
        ok=True,
        json=lambda: {
            "access_token": "cal-access",
            "refresh_token": "cal-refresh",
            "expires_in": 3600,
            "scope": "calendar.events email",
        },
    )
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"email": owner.email})

    response = client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "connected=google" in response.headers["location"]
    assert "tool=calendar" in response.headers["location"]

    conn = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == owner.id, CalendarConnection.provider == "google"
        )
    )
    assert conn is not None
    assert conn.account_email == owner.email


@pytest.mark.integration
@patch("app.api.v1.calendar.http.get")
def test_calendar_upcoming_events(mock_get, client, owner, db, monkeypatch):
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    seed_google_connection(db, owner)
    mock_get.return_value = MagicMock(
        ok=True,
        json=lambda: {
            "items": [
                {
                    "id": "evt-1",
                    "summary": "Team standup",
                    "start": {"dateTime": "2026-06-20T10:00:00Z"},
                    "end": {"dateTime": "2026-06-20T11:00:00Z"},
                    "htmlLink": "https://calendar.google.com/evt-1",
                }
            ]
        },
    )
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/calendar/events", headers=headers)
    assert response.status_code == 200
    assert response.json()[0]["summary"] == "Team standup"


@pytest.mark.integration
@patch("app.services.google_service.calendar_create_timed_event")
def test_calendar_create_timed_event_api(mock_create, client, owner, db, monkeypatch):
    from datetime import datetime, timedelta, timezone

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    seed_google_connection(db, owner)
    mock_create.return_value = {
        "id": "evt-new",
        "link": "https://calendar.google.com/evt-new",
        "all_day": False,
        "meet_link": None,
    }
    headers = auth_headers(client, owner.email)
    start = datetime.now(timezone.utc) + timedelta(hours=1)
    end = start + timedelta(hours=1)

    response = client.post(
        "/api/v1/calendar/events",
        headers=headers,
        json={
            "summary": "Focus block",
            "start_at": start.isoformat(),
            "end_at": end.isoformat(),
        },
    )
    assert response.status_code == 201
    assert response.json()["summary"] == "Focus block"


@pytest.mark.integration
def test_calendar_create_focus_time_rejects_all_day(client, owner, db, monkeypatch):
    from datetime import datetime, timedelta, timezone

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    seed_google_connection(db, owner)
    headers = auth_headers(client, owner.email)
    start = datetime.now(timezone.utc) + timedelta(hours=1)
    end = start + timedelta(hours=1)

    response = client.post(
        "/api/v1/calendar/events",
        headers=headers,
        json={
            "summary": "Focus block",
            "start_at": start.isoformat(),
            "end_at": end.isoformat(),
            "all_day": True,
            "event_type": "focusTime",
        },
    )
    assert response.status_code == 422
    assert "all-day" in response.json()["detail"].lower()


@pytest.mark.integration
@patch("app.api.v1.calendar.http.get")
@patch("app.api.v1.calendar.http.post")
def test_google_callback_partial_error_when_no_scopes_granted(mock_post, mock_get, client, owner, db, monkeypatch):
    from app.api.v1.calendar import _state_token
    from app.models.calendar import CalendarConnection
    from sqlalchemy import select

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    state = _state_token(owner.id, "apps", "gmail")

    mock_post.return_value = MagicMock(
        ok=True,
        json=lambda: {"access_token": "cal-access", "expires_in": 3600, "scope": "email"},
    )
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"email": owner.email})

    response = client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "calendar_error=partial" in response.headers["location"]
    assert db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == owner.id, CalendarConnection.provider == "google"
        )
    ) is None


@pytest.mark.integration
def test_google_callback_oauth_error_redirects(client, owner, monkeypatch):
    from app.api.v1.calendar import _state_token

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    state = _state_token(owner.id, "apps", "calendar")

    response = client.get(
        "/api/v1/calendar/google/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "calendar_error=1" in response.headers["location"]


@pytest.mark.integration
@patch("app.api.v1.calendar.http.get")
@patch("app.api.v1.calendar.http.post")
def test_google_callback_connect_all_partial_error_when_no_tools_granted(mock_post, mock_get, client, owner, db, monkeypatch):
    from app.api.v1.calendar import _state_token
    from app.models.calendar import CalendarConnection
    from sqlalchemy import select

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    state = _state_token(owner.id, "apps", "all")

    mock_post.return_value = MagicMock(
        ok=True,
        json=lambda: {"access_token": "cal-access", "expires_in": 3600, "scope": "email"},
    )
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"email": owner.email})

    response = client.get(
        "/api/v1/calendar/google/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert "calendar_error=partial" in response.headers["location"]
    assert db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == owner.id, CalendarConnection.provider == "google"
        )
    ) is None
