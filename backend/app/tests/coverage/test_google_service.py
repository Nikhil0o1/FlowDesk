"""Phase 6 — Google service scope helpers and token refresh."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models.calendar import CalendarConnection
from app.services import google_service
from app.services.token_vault import seal
from app.tests.helpers import seed_google_connection


@pytest.mark.coverage
def test_google_configured_requires_client_credentials(monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "")
    assert google_service.google_configured() is False

    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")
    assert google_service.google_configured() is True


@pytest.mark.coverage
def test_normalize_scope_token_maps_short_google_names():
    assert google_service.normalize_scope_token("calendar.events") == google_service.SCOPE_CALENDAR
    assert (
        google_service.normalize_scope_token("https://www.googleapis.com/auth/userinfo.email")
        == "email"
    )


@pytest.mark.coverage
@patch("app.services.google_service.http.get")
def test_resolve_oauth_granted_scopes_uses_tokeninfo_fallback(mock_get):
    mock_get.return_value = MagicMock(
        ok=True,
        json=lambda: {"scope": f"{google_service.SCOPE_GMAIL_SEND} {google_service.SCOPE_GMAIL_READ}"},
    )
    scopes = google_service.resolve_oauth_granted_scopes({"access_token": "tok"})
    assert google_service.SCOPE_GMAIL_SEND in scopes


@pytest.mark.coverage
def test_filter_granted_scopes_for_all_supports_partial_gmail():
    granted = " ".join([
        google_service.SCOPE_GMAIL_SEND,
        google_service.SCOPE_GMAIL_READ,
        google_service.SCOPE_CALENDAR,
    ])
    filtered = google_service.filter_granted_scopes_for_tool(granted, "all")
    tokens = google_service.scope_set(filtered)
    assert google_service.SCOPE_GMAIL_SEND in tokens
    assert google_service.SCOPE_CALENDAR in tokens
    assert google_service.SCOPE_SHEETS not in tokens
    probe = google_service.tools_satisfied_by_scope(filtered)
    assert "gmail" in probe
    assert "calendar" in probe
    assert "sheets" not in probe


@pytest.mark.coverage
def test_has_scope_checks_connection_scope_string():
    conn = CalendarConnection(
        user_id=uuid.uuid4(),
        provider="google",
        access_token="x",
        scope=f"{google_service.SCOPE_CALENDAR} email",
    )
    assert google_service.has_scope(conn, google_service.SCOPE_CALENDAR) is True
    assert google_service.has_scope(conn, google_service.SCOPE_GMAIL_SEND) is False
    assert google_service.has_scope(None, google_service.SCOPE_CALENDAR) is False


@pytest.mark.coverage
def test_has_scope_uses_exact_tokens_not_substrings():
    conn = CalendarConnection(
        user_id=uuid.uuid4(),
        provider="google",
        access_token="x",
        scope=google_service.SCOPE_GMAIL_READ,
    )
    assert google_service.has_scope(conn, google_service.SCOPE_GMAIL_SEND) is False
    assert google_service.has_scope(conn, google_service.SCOPE_GMAIL_READ) is True


@pytest.mark.coverage
def test_filter_granted_scopes_for_tool_ignores_other_tools():
    granted = " ".join([
        google_service.SCOPE_CALENDAR,
        google_service.SCOPE_GMAIL_SEND,
        google_service.SCOPE_GMAIL_READ,
        google_service.SCOPE_SHEETS,
        "email",
    ])
    gmail_only = google_service.filter_granted_scopes_for_tool(granted, "gmail")
    tokens = google_service.scope_set(gmail_only)
    assert google_service.SCOPE_GMAIL_SEND in tokens
    assert google_service.SCOPE_GMAIL_READ in tokens
    assert google_service.SCOPE_CALENDAR not in tokens
    assert google_service.SCOPE_SHEETS not in tokens


@pytest.mark.coverage
def test_fresh_access_token_returns_cached_when_valid(db, owner):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    conn = CalendarConnection(
        user_id=owner.id,
        provider="google",
        access_token=seal("cached-token"),
        refresh_token=seal("refresh-token"),
        token_expiry=future,
    )
    db.add(conn)
    db.flush()

    assert google_service.fresh_access_token(db, conn) == "cached-token"


@pytest.mark.coverage
@patch("app.services.google_service.http.post")
def test_fresh_access_token_refreshes_when_expiring(mock_post, db, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")

    conn = CalendarConnection(
        user_id=owner.id,
        provider="google",
        access_token=seal("old-token"),
        refresh_token=seal("refresh-token"),
        token_expiry=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db.add(conn)
    db.flush()

    mock_post.return_value = MagicMock(ok=True, json=lambda: {"access_token": "new-token", "expires_in": 3600})
    token = google_service.fresh_access_token(db, conn)
    assert token == "new-token"
    mock_post.assert_called_once()


@pytest.mark.coverage
def test_fresh_access_token_raises_without_refresh(db, owner):
    conn = CalendarConnection(
        user_id=owner.id,
        provider="google",
        access_token=seal("old-token"),
        refresh_token=None,
        token_expiry=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db.add(conn)
    db.flush()

    with pytest.raises(google_service.GoogleConnectionExpired):
        google_service.fresh_access_token(db, conn)


@pytest.mark.coverage
def test_scopes_for_tool_and_connect():
    assert google_service.scopes_for_connect("all") == google_service.ALL_SCOPES
    assert google_service.SCOPE_CALENDAR in google_service.scopes_for_connect("calendar")
    with pytest.raises(ValueError, match="Unknown Google tool"):
        google_service.scopes_for_tool("docs")


@pytest.mark.coverage
def test_merge_and_remove_tool_scopes():
    existing = f"{google_service.SCOPE_CALENDAR} email"
    merged = google_service.merge_scopes(existing, google_service.SCOPE_GMAIL_SEND)
    assert google_service.SCOPE_CALENDAR in merged
    assert google_service.SCOPE_GMAIL_SEND in merged
    stripped = google_service.remove_tool_scopes(merged, "gmail")
    assert google_service.SCOPE_GMAIL_SEND not in stripped
    assert google_service.SCOPE_CALENDAR in stripped


@pytest.mark.coverage
def test_resolve_oauth_granted_scopes_prefers_token_body():
    scopes = google_service.resolve_oauth_granted_scopes(
        {"access_token": "tok", "scope": google_service.SCOPE_SHEETS}
    )
    assert google_service.SCOPE_SHEETS in scopes


@pytest.mark.coverage
def test_fetch_tokeninfo_scopes_empty_token():
    assert google_service.fetch_tokeninfo_scopes("") == ""


@pytest.mark.coverage
@patch("app.services.google_service.http.get")
def test_fetch_tokeninfo_scopes_handles_errors(mock_get):
    mock_get.side_effect = google_service.http.RequestException("network down")
    assert google_service.fetch_tokeninfo_scopes("tok") == ""

    mock_get.side_effect = None
    mock_get.return_value = MagicMock(ok=False)
    assert google_service.fetch_tokeninfo_scopes("tok") == ""


@pytest.mark.coverage
def test_tool_connection_helpers():
    conn = CalendarConnection(
        user_id=uuid.uuid4(),
        provider="google",
        access_token="x",
        scope=f"{google_service.SCOPE_CALENDAR} {google_service.SCOPE_SHEETS} email",
    )
    assert google_service.tool_is_connected(None, "calendar") is False
    assert google_service.tool_is_connected(conn, "calendar") is True
    assert google_service.tool_is_connected(conn, "sheets") is True
    assert google_service.tool_is_connected(conn, "gmail") is False
    assert google_service.tool_is_connected(conn, "unknown") is False
    assert google_service.other_tools_connected(conn, "gmail") is True
    assert google_service.any_tool_connected(conn) is True
    assert not google_service.all_tools_connected(conn)


@pytest.mark.coverage
def test_tools_newly_connected_detects_first_grant():
    before = google_service.SCOPE_CALENDAR
    incoming = f"{google_service.SCOPE_GMAIL_SEND} {google_service.SCOPE_GMAIL_READ}"
    newly = google_service.tools_newly_connected(before, incoming)
    assert "gmail" in newly
    assert "calendar" not in newly


@pytest.mark.coverage
def test_fresh_access_token_naive_expiry_and_empty_cache(db, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")

    future_naive = datetime.now() + timedelta(hours=1)
    conn = CalendarConnection(
        user_id=owner.id,
        provider="google",
        access_token=seal("cached-token"),
        refresh_token=seal("refresh-token"),
        token_expiry=future_naive,
    )
    db.add(conn)
    db.flush()
    assert google_service.fresh_access_token(db, conn) == "cached-token"

    conn.access_token = seal("")
    db.flush()
    with pytest.raises(google_service.GoogleConnectionExpired):
        google_service.fresh_access_token(db, conn)


@pytest.mark.coverage
@patch("app.services.google_service.http.post")
def test_fresh_access_token_refresh_failure(mock_post, db, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "secret")

    conn = CalendarConnection(
        user_id=owner.id,
        provider="google",
        access_token=seal("old-token"),
        refresh_token=seal("refresh-token"),
        token_expiry=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db.add(conn)
    db.flush()
    mock_post.return_value = MagicMock(ok=False, status_code=400)

    with pytest.raises(google_service.GoogleConnectionExpired):
        google_service.fresh_access_token(db, conn)


@pytest.mark.coverage
@patch("app.services.google_service.http.post")
def test_try_gmail_send_failure_paths(mock_post, db, owner, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.EMAIL_FROM", "no-reply@flowdesk.test")
    seed_google_connection(db, owner)

    mock_post.return_value = MagicMock(ok=False, status_code=403)
    assert google_service.try_gmail_send(db, owner.id, owner.email, "Hi", "<p>Hi</p>") is False

    mock_post.side_effect = RuntimeError("boom")
    assert google_service.try_gmail_send(db, owner.id, owner.email, "Hi", "<p>Hi</p>") is False


@pytest.mark.coverage
@patch("app.services.google_service.http.get")
@patch("app.services.google_service.fresh_access_token", return_value="tok")
def test_gmail_search_error_and_skipped_detail(mock_token, mock_get, db, owner):
    conn = seed_google_connection(db, owner)

    mock_get.return_value = MagicMock(ok=False, status_code=502)
    with pytest.raises(HTTPException) as exc:
        google_service.gmail_search(db, conn, "from:test")
    assert exc.value.status_code == 502

    mock_get.side_effect = [
        MagicMock(ok=True, json=lambda: {"messages": [{"id": "m1"}, {"id": "m2"}]}),
        MagicMock(ok=False),
        MagicMock(
            ok=True,
            json=lambda: {
                "id": "m2",
                "snippet": "ok",
                "payload": {"headers": [{"name": "Subject", "value": "Keep"}]},
            },
        ),
    ]
    results = google_service.gmail_search(db, conn, "from:test")
    assert len(results) == 1
    assert results[0]["subject"] == "Keep"


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.post")
def test_calendar_create_timed_event_branches(mock_post, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"id": "evt", "htmlLink": "https://cal"})

    start = datetime(2026, 6, 20, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 6, 20, 9, 0, tzinfo=timezone.utc)
    google_service.calendar_create_timed_event(
        db,
        conn,
        summary="All day",
        description="",
        start_at=start,
        end_at=end,
        all_day=True,
        location="HQ",
        recurrence="weekly",
    )
    body = mock_post.call_args.kwargs["json"]
    assert body["location"] == "HQ"
    assert body["start"]["date"] == "2026-06-20"
    assert body["recurrence"] == ["RRULE:FREQ=WEEKLY"]

    mock_post.return_value = MagicMock(ok=False, status_code=500)
    with pytest.raises(HTTPException):
        google_service.calendar_create_timed_event(
            db,
            conn,
            summary="Fail",
            description="",
            start_at=datetime.now(timezone.utc),
            end_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.patch")
def test_calendar_update_event_datetime_and_error(mock_patch, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    start = datetime.now(timezone.utc)
    end = start + timedelta(hours=1)

    mock_patch.return_value = MagicMock(ok=True)
    google_service.calendar_update_event(
        db, conn, event_id="evt-1", summary="Updated", description="Desc", start_at=start, end_at=end
    )
    body = mock_patch.call_args.kwargs["json"]
    assert "dateTime" in body["start"]

    mock_patch.return_value = MagicMock(ok=False, status_code=500)
    with pytest.raises(HTTPException):
        google_service.calendar_update_event(
            db, conn, event_id="evt-1", summary="Updated", description="Desc", start_at=start, end_at=end
        )


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.delete")
def test_calendar_delete_event_error(mock_delete, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    mock_delete.return_value = MagicMock(status_code=500)
    with pytest.raises(HTTPException):
        google_service.calendar_delete_event(db, conn, event_id="evt-1")


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.post")
def test_sheets_create_with_tabs_and_error(mock_post, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(
        ok=True, json=lambda: {"spreadsheetId": "sheet-1", "spreadsheetUrl": "https://sheets/1"}
    )
    sheet_id, _url = google_service.sheets_create(db, conn, "Export", tabs=["Tasks", "Done"])
    assert sheet_id == "sheet-1"
    body = mock_post.call_args.kwargs["json"]
    assert len(body["sheets"]) == 2

    mock_post.return_value = MagicMock(ok=False, status_code=403)
    with pytest.raises(HTTPException):
        google_service.sheets_create(db, conn, "Fail")


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.get")
def test_sheets_read_error(mock_get, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    mock_get.return_value = MagicMock(ok=False, status_code=403)
    with pytest.raises(HTTPException):
        google_service.sheets_read(db, conn, "sheet-1")


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.put")
def test_sheets_write_error(mock_put, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    mock_put.return_value = MagicMock(ok=False, status_code=403)
    with pytest.raises(HTTPException):
        google_service.sheets_write(db, conn, "sheet-1", "A1", [["a"]])


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.put")
@patch("app.services.google_service.http.post")
def test_sheets_overwrite_write_error(mock_post, mock_put, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True)
    mock_put.return_value = MagicMock(ok=False, status_code=403)
    with pytest.raises(HTTPException):
        google_service.sheets_overwrite(db, conn, "sheet-1", [["a"]])


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.post")
def test_calendar_create_event_success_and_error(mock_post, _tok, db, owner):
    from datetime import date

    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(
        ok=True, json=lambda: {"id": "evt-day", "htmlLink": "https://calendar/evt-day"}
    )
    result = google_service.calendar_create_event(
        db, conn, summary="Ship", description="Task", day=date(2026, 6, 20)
    )
    assert result["id"] == "evt-day"

    mock_post.return_value = MagicMock(ok=False, status_code=500)
    with pytest.raises(HTTPException):
        google_service.calendar_create_event(
            db, conn, summary="Fail", description="Task", day=date(2026, 6, 20)
        )


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.patch")
def test_calendar_update_event_day_only(mock_patch, _tok, db, owner):
    from datetime import date

    conn = seed_google_connection(db, owner)
    mock_patch.return_value = MagicMock(ok=True)
    google_service.calendar_update_event(
        db, conn, event_id="evt-1", summary="All day", description="Desc", day=date(2026, 6, 20)
    )
    body = mock_patch.call_args.kwargs["json"]
    assert body["start"]["date"] == "2026-06-20"
    assert body["end"]["date"] == "2026-06-21"


@pytest.mark.coverage
def test_try_gmail_send_without_gmail_scope_returns_false(db, owner):
    conn = CalendarConnection(
        user_id=owner.id,
        provider="google",
        access_token=seal("tok"),
        scope=google_service.SCOPE_CALENDAR,
    )
    db.add(conn)
    db.flush()
    assert google_service.try_gmail_send(db, owner.id, owner.email, "Hi", "<p>Hi</p>") is False


@pytest.mark.coverage
def test_user_brief_none_user_id(db):
    from app.services.user_service import user_brief

    assert user_brief(db, None) is None
