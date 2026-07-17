"""PAT secret digests — legacy full-token SHA-256 and v1 HMAC-SHA-256.

Do not combine these into an ambiguous single helper that rebuilds legacy as prefix+secret.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)


def digest_legacy_full_token(raw_token: str) -> str:
    """Hash the complete incoming raw token (including fd_pat_ prefix)."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def digest_v1_secret(secret: str, pepper: bytes) -> str:
    """HMAC-SHA-256 of the secret component only."""
    return hmac.new(pepper, secret.encode("utf-8"), hashlib.sha256).hexdigest()


def parse_pepper_map(raw: str) -> dict[int, bytes]:
    """Parse API_KEY_PEPPERS JSON object {"1":"...","2":"..."} into version→bytes."""
    text = (raw or "").strip()
    if not text:
        return {}
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("API_KEY_PEPPERS must be a JSON object")
    out: dict[int, bytes] = {}
    for key, value in data.items():
        version = int(key)
        if not isinstance(value, str) or not value:
            raise ValueError(f"API_KEY_PEPPERS[{key}] must be a non-empty string")
        out[version] = value.encode("utf-8")
    return out


@lru_cache
def _pepper_map_cached(raw: str) -> dict[int, bytes]:
    return parse_pepper_map(raw)


def get_pepper_map() -> dict[int, bytes]:
    from app.core.config import settings

    return dict(_pepper_map_cached(settings.API_KEY_PEPPERS))


def get_current_pepper_version() -> int:
    from app.core.config import settings

    return int(settings.API_KEY_PEPPER_CURRENT)


def resolve_pepper(pepper_version: int) -> bytes | None:
    """Return the pepper for an exact version, or None if unavailable (fail closed)."""
    return get_pepper_map().get(pepper_version)


def clear_pepper_cache() -> None:
    _pepper_map_cached.cache_clear()
