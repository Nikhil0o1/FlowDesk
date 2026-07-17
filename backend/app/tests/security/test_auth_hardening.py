"""Phase 4 security — auth token abuse, CSRF guards, captcha enforcement."""
import uuid
from unittest.mock import patch

import jwt
import pytest

from app.core.config import settings
from app.core.security import create_access_token
from app.tests.conftest import auth_headers, seed_login_otp
from app.tests.helpers import build_project_stack


@pytest.mark.security
def test_access_token_with_wrong_audience_rejected(client, owner):
    raw = jwt.decode(
        create_access_token(owner.id),
        settings.SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        options={"verify_aud": False, "verify_iss": False},
    )
    raw["aud"] = "wrong-audience"
    tampered = jwt.encode(raw, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tampered}"})
    assert response.status_code == 401


@pytest.mark.security
def test_2fa_verify_rejects_access_token_as_challenge(client, owner):
    token = create_access_token(owner.id, owner.is_platform_superadmin)
    response = client.post(
        "/api/v1/auth/2fa/verify",
        json={"challenge_token": token, "code": "123456"},
    )
    assert response.status_code == 401


@pytest.mark.security
def test_logout_blocks_cross_origin_request(client, owner, db, monkeypatch):
    monkeypatch.setattr("app.api.v1.auth._OTP_REQUEST_MIN_SECONDS", 0)
    seed_login_otp(db, owner.email, "246810")
    login = client.post(
        "/api/v1/auth/otp/verify",
        json={"email": owner.email, "code": "246810"},
    )
    assert login.status_code == 200
    cookie = login.cookies.get("flowdesk_refresh")
    assert cookie

    blocked = client.post(
        "/api/v1/auth/logout",
        cookies={"flowdesk_refresh": cookie},
        headers={"Origin": "https://evil.example"},
    )
    assert blocked.status_code == 403


@pytest.mark.security
@patch("app.services.captcha_service.settings.TURNSTILE_SECRET_KEY", "test-secret")
def test_public_form_submit_requires_captcha_when_enabled(client, db, org, owner):
    from app.models.form import Form

    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=headers,
        json={"name": "Secure Intake", "project_id": str(project.id)},
    )
    assert create.status_code == 201
    form = db.get(Form, uuid.UUID(create.json()["id"]))
    token = form.public_token

    missing = client.post(
        f"/api/v1/public/forms/{token}",
        json={"values": {"title": "Spam"}, "submitter_email": "bot@test.dev"},
    )
    assert missing.status_code == 422
