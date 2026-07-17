"""Central CORS policy for browser clients (split UI/API deploys)."""
from __future__ import annotations

import re

from app.core.config import Settings

# Production UI hostnames — regex safety net when FRONTEND_URL drifts from the
# domain users actually load (custom domain + Render static fallback).
_PRODUCTION_ORIGIN_REGEX = re.compile(
    r"^https://("
    r"([\w-]+\.)?brightcone\.ai"
    r"|flowdesk-ui\.onrender\.com"
    r"|flowdesk-ui-[\w-]+\.onrender\.com"
    r")$",
    re.IGNORECASE,
)


def normalize_origin(origin: str) -> str:
    return origin.strip().rstrip("/")


def origin_allowed(settings: Settings, origin: str | None) -> bool:
    if not origin:
        return False
    normalized = normalize_origin(origin)
    if normalized in settings.cors_origins:
        return True
    if settings.is_production and _PRODUCTION_ORIGIN_REGEX.fullmatch(normalized):
        return True
    return False


def cors_origin_regex(settings: Settings) -> str | None:
    if settings.is_production:
        return _PRODUCTION_ORIGIN_REGEX.pattern
    return None
