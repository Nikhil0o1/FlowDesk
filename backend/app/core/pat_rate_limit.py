"""Redis-backed PAT rate limits on the existing REDIS_URL (prefix fd:rl:)."""

from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict
from threading import Lock

from fastapi import Request

from app.core.api_errors import RATE_LIMITED, SERVICE_UNAVAILABLE, PatApiError
from app.core.rate_limit import trusted_client_ip
from app.core.redis_client import get_redis_client

logger = logging.getLogger(__name__)

KEY_PREFIX = "fd:rl:"

# category → (limit, window_seconds)
CATEGORY_LIMITS: dict[str, tuple[int, int]] = {
    "standard": (120, 60),
    "standard_write": (60, 60),
    "expensive_read": (30, 60),
    "auth_fail": (30, 60),
}

_memory_lock = Lock()
_memory_counters: dict[str, list[float]] = defaultdict(list)


def _limits_for(category: str) -> tuple[int, int]:
    return CATEGORY_LIMITS.get(category, CATEGORY_LIMITS["standard"])


def _incr_redis(key: str, window: int) -> int | None:
    client = get_redis_client()
    if client is None:
        return None
    try:
        pipe = client.pipeline()
        pipe.incr(key)
        pipe.expire(key, window)
        count, _ = pipe.execute()
        return int(count)
    except Exception:
        logger.exception("PAT rate-limit Redis INCR failed for %s", key)
        raise


def _incr_memory(key: str, window: int) -> int:
    now = time.monotonic()
    with _memory_lock:
        bucket = _memory_counters[key]
        cutoff = now - window
        _memory_counters[key] = [t for t in bucket if t >= cutoff]
        _memory_counters[key].append(now)
        return len(_memory_counters[key])


def _rate_limit_disabled() -> bool:
    import os

    return os.environ.get("RATE_LIMIT_ENABLED", "true").lower() in ("0", "false", "no")


def check_counter(key: str, category: str, *, allow_memory_fallback: bool) -> None:
    """Raise PatApiError 429 or 503 when over limit / store unavailable."""
    from app.core.config import settings

    if _rate_limit_disabled():
        return

    limit, window = _limits_for(category)
    redis_configured = settings.redis_enabled
    try:
        count = _incr_redis(key, window)
    except Exception:
        if redis_configured:
            raise PatApiError(503, SERVICE_UNAVAILABLE)
        count = None

    if count is None:
        if redis_configured:
            raise PatApiError(503, SERVICE_UNAVAILABLE)
        if not allow_memory_fallback:
            raise PatApiError(503, SERVICE_UNAVAILABLE)
        count = _incr_memory(key, window)

    if count > limit:
        raise PatApiError(
            429,
            RATE_LIMITED,
            headers={"Retry-After": str(window)},
        )


def check_ip_limit(request: Request, category: str = "auth_fail") -> None:
    from app.core.config import settings

    ip = trusted_client_ip(request)
    key = f"{KEY_PREFIX}ip:{ip}:{category}"
    allow_mem = not settings.is_production
    check_counter(key, category, allow_memory_fallback=allow_mem)


def check_pat_limits(
    *,
    token_id: uuid.UUID,
    organization_id: uuid.UUID | None,
    category: str,
    request: Request,
) -> None:
    from app.core.config import settings

    allow_mem = not settings.is_production and not settings.redis_enabled
    check_counter(
        f"{KEY_PREFIX}pat:{token_id}:{category}",
        category,
        allow_memory_fallback=allow_mem,
    )
    if organization_id is not None:
        check_counter(
            f"{KEY_PREFIX}org:{organization_id}:{category}",
            category,
            allow_memory_fallback=allow_mem,
        )
    # Also bound by IP for authenticated PAT traffic
    ip = trusted_client_ip(request)
    check_counter(
        f"{KEY_PREFIX}ip:{ip}:{category}",
        category,
        allow_memory_fallback=allow_mem,
    )
