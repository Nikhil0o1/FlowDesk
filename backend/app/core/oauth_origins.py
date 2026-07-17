"""OAuth / session cookie wiring for split UI + API deployments."""
from __future__ import annotations

from urllib.parse import urlparse

from app.core.config import settings


def _origin_netloc(url: str) -> str:
    return (urlparse(url).netloc or "").lower()


def is_cross_site_deployment() -> bool:
    """True when the browser sees the UI and API on different site names
    (e.g. flowdesk-ui.onrender.com vs flowdesk-api-mvwt.onrender.com)."""
    return _origin_netloc(settings.FRONTEND_URL) != _origin_netloc(settings.BACKEND_URL)


def cross_site_cookie() -> bool:
    """Use SameSite=None; Secure for session cookies when UI and API are on
    different origins, or any https FRONTEND_URL in production-like deploys."""
    return is_cross_site_deployment() or (
        settings.ENVIRONMENT == "production" or settings.FRONTEND_URL.startswith("https://")
    )


def google_sso_redirect_uri() -> str:
    """OAuth callback URL — must match Google Cloud Console redirect URIs exactly."""
    return f"{settings.BACKEND_URL.rstrip('/')}/api/v1/auth/google/callback"


def oauth_state_cookie_path() -> str:
    return "/api/v1/auth"


def browser_api_origin() -> str:
    """Origin the browser should use for API navigation (OAuth start). Same as
    BACKEND_URL when split; matches FRONTEND_URL when same-origin deployed."""
    if is_cross_site_deployment():
        return settings.BACKEND_URL.rstrip("/")
    return settings.FRONTEND_URL.rstrip("/")
