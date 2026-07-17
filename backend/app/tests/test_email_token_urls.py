"""Email link helpers — tokens delivered via query param (survives Gmail proxy rewriting)."""
from urllib.parse import quote, unquote

from app.core.config import settings
from app.services import email_service


def test_activate_url_uses_query_token(monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.example.com")
    url = email_service._activate_url("invite/secret+token")
    assert url == "https://app.example.com/activate-invite?token=invite%2Fsecret%2Btoken"
    assert "#" not in url
    assert unquote(url.split("?token=", 1)[1]) == "invite/secret+token"


def test_reset_password_url_uses_query_token(monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.example.com")
    url = email_service._fragment_token_url("/reset-password", "reset-token")
    assert url == f"https://app.example.com/reset-password?token={quote('reset-token', safe='')}"
