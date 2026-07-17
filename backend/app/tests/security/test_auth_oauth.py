"""OAuth login flows (Google, Microsoft) with mocked identity providers."""
from unittest.mock import MagicMock, patch

import pytest

pytestmark = pytest.mark.security

def _mock_google_verify(info: dict):
    return patch(
        "app.services.auth_service.google_id_token.verify_oauth2_token",
        return_value=info,
    )


def _mock_microsoft_decode(claims: dict):
    mock_key = MagicMock()
    mock_key.key = "test-key"
    mock_client = MagicMock()
    mock_client.get_signing_key_from_jwt.return_value = mock_key
    return (
        patch("app.services.auth_service._microsoft_jwks_client", return_value=mock_client),
        patch("app.services.auth_service.jwt.decode", return_value=claims),
    )


def test_google_login_success(client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "google-client-id")
    owner.google_sub = None
    db.flush()

    with _mock_google_verify(
        {"email": "owner@test.dev", "email_verified": True, "sub": "google-sub-123"}
    ):
        response = client.post("/api/v1/auth/google", json={"id_token": "fake-google-id-token"})

    assert response.status_code == 200, response.text
    assert response.json()["access_token"]
    assert response.cookies.get("flowdesk_refresh")
    assert owner.google_sub == "google-sub-123"


def test_google_login_unknown_user_invite_only(client, db, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "google-client-id")

    with _mock_google_verify(
        {"email": "stranger@test.dev", "email_verified": True, "sub": "google-sub-999"}
    ):
        response = client.post("/api/v1/auth/google", json={"id_token": "fake-google-id-token"})

    assert response.status_code == 403


def test_google_login_pending_invite_requires_activation(client, db, org, owner, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from app.models.invite import Invite

    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "google-client-id")
    db.add(
        Invite(
            email="pending@test.dev",
            token_hash="hash",
            scope="workspace",
            role="member",
            organization_id=org.id,
            invited_by=owner.id,
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        )
    )
    db.commit()

    with _mock_google_verify(
        {"email": "pending@test.dev", "email_verified": True, "sub": "google-sub-pending"}
    ):
        response = client.post("/api/v1/auth/google", json={"id_token": "fake-google-id-token"})

    assert response.status_code == 403
    assert "pending invitation" in response.json()["detail"].lower()
    assert "invitation" in response.json()["detail"].lower()


def test_google_login_unverified_email_rejected(client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "google-client-id")

    with _mock_google_verify(
        {"email": "owner@test.dev", "email_verified": False, "sub": "google-sub-123"}
    ):
        response = client.post("/api/v1/auth/google", json={"id_token": "fake-google-id-token"})

    assert response.status_code == 401


def test_google_login_not_configured(client, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.GOOGLE_CLIENT_ID", "")

    response = client.post("/api/v1/auth/google", json={"id_token": "any"})
    assert response.status_code == 503


def test_microsoft_login_success(client, db, org, owner, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_CLIENT_ID", "ms-client-id")
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_TENANT", "organizations")
    owner.microsoft_sub = None
    db.flush()

    tid = "contoso-tenant-id"
    jwks_patch, decode_patch = _mock_microsoft_decode(
        {
            "tid": tid,
            "iss": f"https://login.microsoftonline.com/{tid}/v2.0",
            "oid": "ms-oid-456",
            "email": "owner@test.dev",
            "email_verified": True,
        }
    )
    with jwks_patch, decode_patch:
        response = client.post("/api/v1/auth/microsoft", json={"id_token": "fake-ms-id-token"})

    assert response.status_code == 200, response.text
    assert response.json()["access_token"]
    assert owner.microsoft_sub == "ms-oid-456"


def test_microsoft_consumer_tenant_rejected_for_organizations(client, db, monkeypatch):
    from app.services.auth_service import _MS_CONSUMER_TENANT

    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_CLIENT_ID", "ms-client-id")
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_TENANT", "organizations")

    jwks_patch, decode_patch = _mock_microsoft_decode(
        {
            "tid": _MS_CONSUMER_TENANT,
            "iss": f"https://login.microsoftonline.com/{_MS_CONSUMER_TENANT}/v2.0",
            "oid": _MS_CONSUMER_TENANT,
            "email": "owner@test.dev",
        }
    )
    with jwks_patch, decode_patch:
        response = client.post("/api/v1/auth/microsoft", json={"id_token": "fake-ms-id-token"})

    assert response.status_code == 401


def test_microsoft_login_unknown_user_invite_only(client, db, monkeypatch):
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_CLIENT_ID", "ms-client-id")
    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_TENANT", "organizations")

    tid = "contoso-tenant-id"
    jwks_patch, decode_patch = _mock_microsoft_decode(
        {
            "tid": tid,
            "iss": f"https://login.microsoftonline.com/{tid}/v2.0",
            "oid": "ms-oid-unknown",
            "email": "nobody@test.dev",
        }
    )
    with jwks_patch, decode_patch:
        response = client.post("/api/v1/auth/microsoft", json={"id_token": "fake-ms-id-token"})

    assert response.status_code == 403


def test_jwt_manipulation_rejected(client, owner):
    """Tampered bearer token must not authenticate."""
    headers = {"Authorization": "Bearer not.a.valid.jwt"}
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_expired_access_token_rejected(client, owner, monkeypatch):
    from datetime import timedelta

    from app.core.security import create_access_token

    monkeypatch.setattr("app.core.security.settings.ACCESS_TOKEN_EXPIRE_MINUTES", -1)
    token = create_access_token(owner.id, owner.is_platform_superadmin)
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
