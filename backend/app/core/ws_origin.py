"""Origin allowlist for browser WebSocket upgrades."""
from __future__ import annotations

from fastapi import WebSocket

from app.core.config import settings
from app.core.cors_policy import origin_allowed


def ws_origin_allowed(ws: WebSocket) -> bool:
    """Return True if the WebSocket Origin is permitted for the in-app path.

    Production: Origin header required and must match CORS allowlist.
    Non-production: missing Origin allowed (TestClient / native clients); when
    present it must still match the allowlist.
    WS_SKIP_ORIGIN_CHECK is honored only when not production.
    """
    if settings.is_production:
        origin = ws.headers.get("origin")
        return origin_allowed(settings, origin)

    if settings.WS_SKIP_ORIGIN_CHECK:
        return True

    origin = ws.headers.get("origin")
    if not origin:
        return True
    return origin_allowed(settings, origin)
