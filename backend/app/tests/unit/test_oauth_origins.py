"""Unit tests for OAuth origin helpers."""
import pytest

from app.core import oauth_origins


@pytest.mark.unit
def test_cross_site_deployment_detects_different_hosts(monkeypatch):
    monkeypatch.setattr(oauth_origins.settings, "FRONTEND_URL", "https://ui.example.com")
    monkeypatch.setattr(oauth_origins.settings, "BACKEND_URL", "https://api.example.com")
    assert oauth_origins.is_cross_site_deployment() is True
    assert oauth_origins.cross_site_cookie() is True
    assert oauth_origins.browser_api_origin() == "https://api.example.com"


@pytest.mark.unit
def test_same_site_deployment_uses_frontend_origin(monkeypatch):
    monkeypatch.setattr(oauth_origins.settings, "FRONTEND_URL", "https://app.example.com")
    monkeypatch.setattr(oauth_origins.settings, "BACKEND_URL", "https://app.example.com")
    monkeypatch.setattr(oauth_origins.settings, "ENVIRONMENT", "development")
    assert oauth_origins.is_cross_site_deployment() is False
    assert oauth_origins.browser_api_origin() == "https://app.example.com"


@pytest.mark.unit
def test_google_sso_redirect_uri_and_state_cookie_path(monkeypatch):
    monkeypatch.setattr(oauth_origins.settings, "BACKEND_URL", "https://api.example.com/")
    assert (
        oauth_origins.google_sso_redirect_uri()
        == "https://api.example.com/api/v1/auth/google/callback"
    )
    assert oauth_origins.oauth_state_cookie_path() == "/api/v1/auth"
