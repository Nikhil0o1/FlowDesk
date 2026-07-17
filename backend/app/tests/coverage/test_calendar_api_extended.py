"""Coverage — calendar disconnect and status when connected."""
from unittest.mock import MagicMock, patch

import pytest

from app.services import google_service
from app.tests.conftest import auth_headers
from app.tests.helpers import seed_google_connection


@pytest.mark.coverage
@patch("app.api.v1.calendar.http.post")
def test_disconnect_google_calendar(mock_post, client, owner, db, monkeypatch):
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True)
    headers = auth_headers(client, owner.email)

    response = client.delete("/api/v1/calendar/google", headers=headers)
    assert response.status_code == 200
    assert "disconnected" in response.json()["detail"].lower()

    status = client.get("/api/v1/calendar/status", headers=headers)
    assert status.json()["google"]["connected"] is False


@pytest.mark.coverage
def test_disconnect_google_without_connection(client, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    headers = auth_headers(client, owner.email)

    response = client.delete("/api/v1/calendar/google", headers=headers)
    assert response.status_code == 404


@pytest.mark.coverage
def test_google_auth_url_requests_calendar_scopes_only(client, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    headers = auth_headers(client, owner.email)

    response = client.get(
        "/api/v1/calendar/google/auth-url",
        headers=headers,
        params={"tool": "gmail"},
    )
    assert response.status_code == 200
    url = response.json()["url"]
    assert "gmail.send" in url
    assert "gmail.readonly" in url
    assert "calendar.events" not in url
    assert "spreadsheets" not in url


@pytest.mark.coverage
@patch("app.api.v1.calendar.http.post")
def test_disconnect_google_tool_keeps_other_scopes(mock_post, client, owner, db, monkeypatch):
    from app.models.calendar import CalendarConnection
    from app.services import google_service
    from sqlalchemy import select

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True)
    headers = auth_headers(client, owner.email)

    response = client.delete("/api/v1/calendar/google", headers=headers, params={"tool": "gmail"})
    assert response.status_code == 200
    assert "Gmail disconnected" in response.json()["detail"]

    conn = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == owner.id, CalendarConnection.provider == "google"
        )
    )
    assert conn is not None
    assert google_service.has_scope(conn, google_service.SCOPE_CALENDAR)
    assert not google_service.has_scope(conn, google_service.SCOPE_GMAIL_SEND)


@pytest.mark.coverage
def test_google_auth_url_connect_all_requests_every_scope(client, owner, monkeypatch):
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    headers = auth_headers(client, owner.email)

    response = client.get(
        "/api/v1/calendar/google/auth-url",
        headers=headers,
        params={"next": "apps", "tool": "all"},
    )
    assert response.status_code == 200
    body = response.json()["url"]
    assert "calendar.events" in body
    assert "gmail.send" in body
    assert "gmail.readonly" in body
    assert "spreadsheets" in body
    assert "enable_granular_consent=true" in body


@pytest.mark.coverage
@patch("app.api.v1.calendar.http.get")
def test_calendar_auth_url_prompt_when_connected(mock_get, client, owner, db, monkeypatch):
    from app.models.calendar import CalendarConnection
    from app.services.token_vault import seal

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    db.add(
        CalendarConnection(
            user_id=owner.id,
            provider="google",
            account_email=owner.email,
            access_token=seal("token"),
            refresh_token=seal("refresh"),
            scope=google_service.scopes_for_tool("calendar"),
        )
    )
    db.commit()
    mock_get.return_value = MagicMock(ok=True, json=lambda: {"items": []})
    headers = auth_headers(client, owner.email)

    url = client.get("/api/v1/calendar/google/auth-url", headers=headers, params={"next": "apps"})
    assert url.status_code == 200
    body = url.json()["url"]
    assert "select_account" in body
    assert "include_granted_scopes" not in body


@pytest.mark.coverage
def test_calendar_auth_url_includes_granted_scopes_when_other_tool_connected(client, owner, db, monkeypatch):
    from app.models.calendar import CalendarConnection
    from app.services.token_vault import seal

    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.api.v1.calendar.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    db.add(
        CalendarConnection(
            user_id=owner.id,
            provider="google",
            account_email=owner.email,
            access_token=seal("token"),
            refresh_token=seal("refresh"),
            scope=google_service.scopes_for_tool("gmail"),
        )
    )
    db.commit()
    headers = auth_headers(client, owner.email)

    response = client.get(
        "/api/v1/calendar/google/auth-url",
        headers=headers,
        params={"next": "apps", "tool": "calendar"},
    )
    assert response.status_code == 200
    body = response.json()["url"]
    assert "include_granted_scopes=true" in body
    assert "enable_granular_consent=true" in body
    assert "calendar.events" in body
    assert "gmail.send" not in body
