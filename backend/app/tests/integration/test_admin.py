"""Phase 3 integration — platform admin API."""
from unittest.mock import patch

import pytest

from app.tests.conftest import auth_headers, make_user


@pytest.mark.integration
def test_superadmin_lists_organizations(client, db, org, owner, superadmin):
    headers = auth_headers(client, "super@test.dev")
    response = client.get("/api/v1/admin/organizations", headers=headers)
    assert response.status_code == 200
    assert response.json()["total"] >= 1


@pytest.mark.integration
def test_non_superadmin_cannot_access_admin(client, owner):
    headers = auth_headers(client, owner.email)
    assert client.get("/api/v1/admin/organizations", headers=headers).status_code == 403


@pytest.mark.integration
def test_superadmin_create_organization_rejects_invalid_owner_email(client, db, superadmin):
    headers = auth_headers(client, "super@test.dev")
    response = client.post(
        "/api/v1/admin/organizations",
        headers=headers,
        json={
            "name": "Bad Email Org",
            "owner_email": "ganesh@gmailkkdsfm.com",
        },
    )
    assert response.status_code == 422


@pytest.mark.integration
@patch("app.services.invite_service.email_service")
def test_superadmin_create_organization(_mock_email, client, db, superadmin):
    headers = auth_headers(client, "super@test.dev")
    response = client.post(
        "/api/v1/admin/organizations",
        headers=headers,
        json={
            "name": "Admin Created Org",
            "owner_email": "neworgowner@test.dev",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["name"] == "Admin Created Org"


@pytest.mark.integration
def test_superadmin_disable_org(client, db, org, owner, superadmin):
    headers = auth_headers(client, "super@test.dev")
    disable = client.post(f"/api/v1/admin/organizations/{org.id}/disable", headers=headers)
    assert disable.status_code == 200
    db.refresh(org)
    assert org.is_disabled is True

    enable = client.post(f"/api/v1/admin/organizations/{org.id}/enable", headers=headers)
    assert enable.status_code == 200
    db.refresh(org)
    assert org.is_disabled is False


@pytest.mark.integration
def test_superadmin_platform_stats(client, db, org, owner, superadmin):
    headers = auth_headers(client, "super@test.dev")
    stats = client.get("/api/v1/admin/stats", headers=headers)
    assert stats.status_code == 200
    assert "organizations" in stats.json()
