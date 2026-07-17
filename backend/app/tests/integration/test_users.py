"""Phase 3 integration — user profile API."""
import pytest

from app.tests.conftest import auth_headers


@pytest.mark.integration
def test_update_profile(client, db, owner):
    headers = auth_headers(client, owner.email)

    patch = client.patch(
        "/api/v1/users/me/profile",
        headers=headers,
        json={"full_name": "Updated Owner", "status_text": "In a meeting"},
    )
    assert patch.status_code == 200
    data = patch.json()
    assert data["profile"]["full_name"] == "Updated Owner"
    assert data["profile"]["status_text"] == "In a meeting"


@pytest.mark.integration
def test_clear_status_text(client, db, owner):
    headers = auth_headers(client, owner.email)
    client.patch(
        "/api/v1/users/me/profile",
        headers=headers,
        json={"status_text": "Busy"},
    )

    patch = client.patch(
        "/api/v1/users/me/profile",
        headers=headers,
        json={"clear_status": True},
    )
    assert patch.status_code == 200
    assert patch.json()["profile"]["status_text"] is None


@pytest.mark.integration
def test_profile_requires_auth(client):
    assert client.patch("/api/v1/users/me/profile", json={"full_name": "X"}).status_code == 401


@pytest.mark.integration
def test_user_activity_feed(client, db, owner):
    headers = auth_headers(client, owner.email)
    client.patch(
        "/api/v1/users/me/profile",
        headers=headers,
        json={"full_name": "Activity User"},
    )
    activity = client.get("/api/v1/users/me/activity", headers=headers)
    assert activity.status_code == 200
    assert isinstance(activity.json(), list)
