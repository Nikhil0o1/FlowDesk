"""Unit tests for integration OAuth apps (ClickUp-shaped authorize / token)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from app.core.api_key_digest import clear_pepper_cache
from app.models.integration_oauth import IntegrationOAuthApp
from app.schemas.integration_oauth import (
    IntegrationOAuthAppCreate,
    IntegrationOAuthAppUpdate,
)
from app.services import integration_oauth_service as svc


@pytest.fixture(autouse=True)
def _clear_peppers(monkeypatch):
    monkeypatch.setenv("API_KEY_PEPPERS", "")
    clear_pepper_cache()
    from app.core import config

    monkeypatch.setattr(config.settings, "API_KEY_PEPPERS", "")
    monkeypatch.setattr(config.settings, "API_KEY_PEPPER_CURRENT", 1)
    clear_pepper_cache()
    yield
    clear_pepper_cache()


def _make_app(**overrides) -> IntegrationOAuthApp:
    raw, public_id, digest, suffix, pepper_version = svc._mint_client_secret()
    app = IntegrationOAuthApp(
        id=overrides.get("id", uuid.uuid4()),
        organization_id=overrides.get("organization_id", uuid.uuid4()),
        created_by_user_id=overrides.get("created_by_user_id", uuid.uuid4()),
        name=overrides.get("name", "Holocron"),
        client_id=overrides.get("client_id", "fd_app_TESTCLIENT"),
        secret_public_id=public_id,
        secret_digest=digest,
        hash_version=1,
        pepper_version=pepper_version,
        display_suffix=suffix,
        redirect_uris=overrides.get(
            "redirect_uris",
            ["http://localhost:8000/api/v1/tools/config/oauth/callback"],
        ),
        default_scopes=overrides.get("default_scopes", ["tasks:read", "profile:read"]),
    )
    app._raw_secret = raw  # type: ignore[attr-defined]
    return app


def test_mint_and_verify_client_secret():
    app = _make_app()
    raw = app._raw_secret  # type: ignore[attr-defined]
    assert raw.startswith("fd_appsec_")
    assert svc.verify_client_secret(app, raw) is True
    assert svc.verify_client_secret(app, "fd_appsec_wrong_secret") is False
    assert svc.verify_client_secret(app, "not-a-secret") is False
    assert svc.verify_client_secret(app, "fd_appsec_") is False
    assert svc.verify_client_secret(app, "fd_appsec_onlyid_") is False


def test_verify_client_secret_wrong_public_id():
    app = _make_app()
    raw = app._raw_secret  # type: ignore[attr-defined]
    # Swap public id segment so parse succeeds but public_id mismatches
    parts = raw.split("_")
    # fd_appsec_{public_id}_{secret}
    bad = f"fd_appsec_XXXXXXXXXXXX_{parts[-1]}"
    assert svc.verify_client_secret(app, bad) is False


def test_env_snippet_derives_webhook_from_redirect(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "BACKEND_URL", "https://flowdesk-api.example.com")
    snippet = svc.env_snippet(
        client_id="fd_app_ABC",
        client_secret="fd_appsec_x_y",
        redirect_uri="https://apps.example.com/api/v1/tools/config/oauth/callback",
    )
    assert "FLOWDESK_CLIENT_ID=fd_app_ABC" in snippet
    assert "FLOWDESK_WEBHOOK_BASE_URL=https://apps.example.com/api/v1/webhooks/flowdesk" in snippet


def test_env_snippet_oauth_callback_marker(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "BACKEND_URL", "https://api.example.com")
    snippet = svc.env_snippet(
        client_id="c",
        client_secret="s",
        redirect_uri="https://apps.example.com/oauth/callback",
    )
    assert "FLOWDESK_WEBHOOK_BASE_URL=https://apps.example.com/api/v1/webhooks/flowdesk" in snippet


def test_env_snippet_default_placeholders(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "BACKEND_URL", "https://api.example.com")
    snippet = svc.env_snippet(client_id="c", client_secret="s")
    assert "FLOWDESK_REDIRECT_URI=https://<your-app-host>/oauth/callback" in snippet
    assert "FLOWDESK_DEFAULT_BASE_URL=https://api.example.com/api/v1" in snippet


def test_authorize_and_token_urls(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "BACKEND_URL", "https://api.example.com")
    assert "{client_id}" in svc.authorize_url_template()
    assert svc.token_url().endswith("/api/v1/oauth/integrations/token")


def test_validate_redirect_uri_exact_match():
    app = MagicMock()
    app.redirect_uris = ["https://holocron.example.com/callback"]
    svc.validate_redirect_uri(app, "https://holocron.example.com/callback")
    with pytest.raises(ValueError):
        svc.validate_redirect_uri(app, "https://evil.example.com/callback")


def test_schema_redirect_uri_validation():
    ok = IntegrationOAuthAppCreate(
        name="  App  ",
        redirect_uris=["https://apps.example.com/cb", "http://localhost:3000/cb"],
    )
    assert ok.name == "App"
    assert len(ok.redirect_uris) == 2

    with pytest.raises(ValidationError):
        IntegrationOAuthAppCreate(name="x", redirect_uris=["http://evil.com/cb"])
    with pytest.raises(ValidationError):
        IntegrationOAuthAppCreate(name="   ", redirect_uris=["https://ok.example/cb"])
    with pytest.raises(ValidationError):
        IntegrationOAuthAppCreate(name="x", redirect_uris=["   "])

    upd = IntegrationOAuthAppUpdate(name="  Renamed  ", redirect_uris=None)
    assert upd.name == "Renamed"
    with pytest.raises(ValidationError):
        IntegrationOAuthAppUpdate(name="   ")
    with pytest.raises(ValidationError):
        IntegrationOAuthAppUpdate(redirect_uris=["ftp://bad"])


def test_create_list_update_revoke_app_flow(db, org, owner):
    raw, app = svc.create_app(
        db,
        organization_id=org.id,
        created_by_user_id=owner.id,
        name="  Brightcone  ",
        redirect_uris=["http://127.0.0.1:8000/oauth/callback"],
        default_scopes=["tasks:read", "mcp:audit", "profile:read"],
    )
    db.flush()
    assert raw.startswith("fd_appsec_")
    assert app.name == "Brightcone"
    assert "mcp:audit" not in app.default_scopes
    assert "tasks:read" in app.default_scopes

    listed = svc.list_org_apps(db, org.id)
    assert len(listed) == 1
    assert svc.get_active_app(db, app.client_id) is app
    assert svc.get_app_by_client_id(db, "missing") is None

    updated = svc.update_app(
        db,
        app,
        name="Renamed",
        redirect_uris=["https://apps.example.com/oauth/callback"],
        default_scopes=["tasks:write"],
    )
    assert updated.name == "Renamed"
    assert updated.default_scopes == ["tasks:write"]

    new_raw, app = svc.regenerate_secret(db, app)
    assert new_raw != raw
    assert svc.verify_client_secret(app, new_raw)

    svc.revoke_app(db, app)
    assert app.revoked_at is not None
    assert svc.get_active_app(db, app.client_id) is None
    assert len(svc.list_org_apps(db, org.id, include_revoked=False)) == 0
    assert len(svc.list_org_apps(db, org.id, include_revoked=True)) == 1

    with pytest.raises(ValueError, match="revoked"):
        svc.update_app(db, app, name="Nope")
    with pytest.raises(ValueError, match="revoked"):
        svc.regenerate_secret(db, app)


def test_create_app_rejects_empty_scopes(db, org, owner, monkeypatch):
    monkeypatch.setattr(svc, "DEFAULT_INTEGRATION_SCOPES", [])
    with pytest.raises(ValueError, match="cannot be empty|No valid"):
        svc.create_app(
            db,
            organization_id=org.id,
            created_by_user_id=owner.id,
            name="Bad",
            redirect_uris=["http://localhost:1/cb"],
            default_scopes=[],
        )


def test_create_app_max_per_org(db, org, owner, monkeypatch):
    monkeypatch.setattr(svc, "MAX_APPS_PER_ORG", 1)
    svc.create_app(
        db,
        organization_id=org.id,
        created_by_user_id=owner.id,
        name="One",
        redirect_uris=["http://localhost:1/cb"],
    )
    with pytest.raises(ValueError, match="Maximum"):
        svc.create_app(
            db,
            organization_id=org.id,
            created_by_user_id=owner.id,
            name="Two",
            redirect_uris=["http://localhost:1/cb"],
        )


def test_authorization_and_token_exchange_happy_path(db, org, owner):
    raw_secret, app = svc.create_app(
        db,
        organization_id=org.id,
        created_by_user_id=owner.id,
        name="Holocron",
        redirect_uris=["http://localhost:8000/oauth/callback"],
        default_scopes=["tasks:read", "profile:read"],
    )
    db.flush()

    req = svc.create_authorization_request(
        db,
        client_id=app.client_id,
        redirect_uri="http://localhost:8000/oauth/callback",
        state="xyz",
        scope="tasks:read",
    )
    db.flush()
    assert svc.get_authorization_request(db, req.id) is not None
    assert svc.user_is_org_member(db, owner.id, org.id)

    redirect = svc.approve_authorization_request(db, request_id=req.id, user_id=owner.id)
    assert "code=" in redirect
    assert "state=xyz" in redirect
    assert svc.get_authorization_request(db, req.id) is None

    from urllib.parse import parse_qs, urlparse

    code = parse_qs(urlparse(redirect).query)["code"][0]
    access_token, scopes = svc.exchange_authorization_code(
        db,
        client_id=app.client_id,
        client_secret=raw_secret,
        code=code,
    )
    assert access_token.startswith("fd_live_")
    assert scopes == ["tasks:read"]

    authorized = svc.list_user_authorized_apps(db, owner.id)
    assert len(authorized) == 1
    assert authorized[0]["client_id"] == app.client_id
    assert authorized[0]["workspace_count"] >= 1

    revoked = svc.unauthorize_user_app(db, owner.id, app.id)
    assert revoked == 1
    db.expire_all()
    assert svc.list_user_authorized_apps(db, owner.id) == []


def test_create_authorization_request_errors(db, org, owner):
    raw_secret, app = svc.create_app(
        db,
        organization_id=org.id,
        created_by_user_id=owner.id,
        name="App",
        redirect_uris=["http://localhost:8000/cb"],
        default_scopes=["tasks:read"],
    )
    db.flush()
    _ = raw_secret

    with pytest.raises(LookupError):
        svc.create_authorization_request(
            db,
            client_id="fd_app_MISSING",
            redirect_uri="http://localhost:8000/cb",
            state=None,
            scope=None,
        )
    with pytest.raises(ValueError, match="Unregistered"):
        svc.create_authorization_request(
            db,
            client_id=app.client_id,
            redirect_uri="http://evil/cb",
            state=None,
            scope=None,
        )
    with pytest.raises(ValueError, match="exceed"):
        svc.create_authorization_request(
            db,
            client_id=app.client_id,
            redirect_uri="http://localhost:8000/cb",
            state=None,
            scope="tasks:write",
        )


def test_approve_expired_and_non_member(db, org, owner):
    from app.tests.conftest import make_user

    raw_secret, app = svc.create_app(
        db,
        organization_id=org.id,
        created_by_user_id=owner.id,
        name="App",
        redirect_uris=["http://localhost:8000/cb"],
    )
    db.flush()
    _ = raw_secret

    req = svc.create_authorization_request(
        db,
        client_id=app.client_id,
        redirect_uri="http://localhost:8000/cb",
        state=None,
        scope=None,
    )
    req.expires_at = svc._now() - timedelta(minutes=1)
    db.flush()
    with pytest.raises(LookupError):
        svc.approve_authorization_request(db, request_id=req.id, user_id=owner.id)

    req2 = svc.create_authorization_request(
        db,
        client_id=app.client_id,
        redirect_uri="http://localhost:8000/cb",
        state=None,
        scope=None,
    )
    outsider = make_user(db, "outsider@test.dev")
    with pytest.raises(PermissionError):
        svc.approve_authorization_request(db, request_id=req2.id, user_id=outsider.id)


def test_exchange_invalid_grant(db, org, owner):
    raw_secret, app = svc.create_app(
        db,
        organization_id=org.id,
        created_by_user_id=owner.id,
        name="App",
        redirect_uris=["http://localhost:8000/cb"],
    )
    db.flush()

    with pytest.raises(LookupError, match="invalid_client"):
        svc.exchange_authorization_code(
            db, client_id=app.client_id, client_secret="bad", code="x"
        )
    with pytest.raises(LookupError, match="invalid_grant"):
        svc.exchange_authorization_code(
            db, client_id=app.client_id, client_secret=raw_secret, code="not-a-code"
        )


def test_unauthorize_errors(db, org, owner):
    with pytest.raises(LookupError, match="app_not_found"):
        svc.unauthorize_user_app(db, owner.id, uuid.uuid4())

    _, app = svc.create_app(
        db,
        organization_id=org.id,
        created_by_user_id=owner.id,
        name="App",
        redirect_uris=["http://localhost:8000/cb"],
    )
    db.flush()
    with pytest.raises(LookupError, match="authorization_not_found"):
        svc.unauthorize_user_app(db, owner.id, app.id)


def test_resolve_pepper_missing_in_production(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "API_KEY_PEPPERS", "")
    monkeypatch.setattr(config.settings, "ENVIRONMENT", "production")
    clear_pepper_cache()
    with pytest.raises(ValueError, match="API_KEY_PEPPER"):
        svc._resolve_pepper_for_issue()
