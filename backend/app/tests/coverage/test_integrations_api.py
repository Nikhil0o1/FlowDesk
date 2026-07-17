"""Phase 6 — integrations API surface."""
import pytest

from app.models.calendar import CalendarConnection
from app.tests.conftest import auth_headers


@pytest.mark.coverage
def test_google_integration_status_disconnected(client, owner, monkeypatch):
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/integrations/google/status", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is True
    assert data["connected"] is False
    assert data["scopes"]["calendar"] is False


@pytest.mark.coverage
def test_google_integration_status_connected(client, db, owner, monkeypatch):
    from app.services import google_service

    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr("app.services.google_service.settings.GOOGLE_CLIENT_SECRET", "google-secret")
    db.add(
        CalendarConnection(
            user_id=owner.id,
            provider="google",
            account_email="owner@test.dev",
            access_token="plain-token",
            refresh_token="plain-refresh",
            scope=f"{google_service.SCOPE_CALENDAR} {google_service.SCOPE_SHEETS}",
        )
    )
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/integrations/google/status", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["connected"] is True
    assert data["account_email"] == "owner@test.dev"
    assert data["scopes"]["calendar"] is True
    assert data["scopes"]["sheets"] is True
