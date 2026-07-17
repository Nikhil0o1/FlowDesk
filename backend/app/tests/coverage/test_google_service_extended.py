"""Coverage — Google service calendar update/delete and token refresh."""
from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from app.services import google_service
from app.tests.helpers import seed_google_connection


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="token")
@patch("app.services.google_service.http.patch")
def test_calendar_update_event(mock_patch, _mock_token, db, owner):
    conn = seed_google_connection(db, owner)
    mock_patch.return_value = MagicMock(ok=True)
    google_service.calendar_update_event(
        db, conn, event_id="evt-1", summary="Updated", description="Desc", day=date.today()
    )
    mock_patch.assert_called_once()


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="token")
@patch("app.services.google_service.http.delete")
def test_calendar_delete_event(mock_delete, _mock_token, db, owner):
    conn = seed_google_connection(db, owner)
    mock_delete.return_value = MagicMock(status_code=204)
    google_service.calendar_delete_event(db, conn, event_id="evt-1")
    mock_delete.assert_called_once()


@pytest.mark.coverage
def test_get_connection_returns_none_when_missing(db, owner):
    assert google_service.get_connection(db, owner.id) is None


@pytest.mark.coverage
@patch("app.services.google_service.http.post")
def test_fresh_access_token_refresh(mock_post, db, owner):
    from datetime import datetime, timezone

    conn = seed_google_connection(db, owner)
    conn.token_expiry = datetime(2000, 1, 1, tzinfo=timezone.utc)
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"access_token": "new-token", "expires_in": 3600})
    token = google_service.fresh_access_token(db, conn)
    assert token == "new-token"
