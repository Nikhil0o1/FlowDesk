"""Shared Redis connection pool for pub/sub and health checks."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import redis

logger = logging.getLogger(__name__)


@lru_cache
def get_redis_pool(redis_url: str, max_connections: int) -> redis.ConnectionPool | None:
    if not redis_url.strip():
        return None
    import redis

    return redis.ConnectionPool.from_url(
        redis_url,
        decode_responses=True,
        max_connections=max_connections,
        socket_timeout=5,
        socket_connect_timeout=5,
        health_check_interval=30,
    )


def get_redis_client() -> redis.Redis | None:
    from app.core.config import settings

    pool = get_redis_pool(settings.REDIS_URL, settings.REDIS_MAX_CONNECTIONS)
    if pool is None:
        return None
    import redis

    return redis.Redis(connection_pool=pool)


def redis_ping() -> bool:
    """Return True if Redis is configured and responds to PING."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        return client.ping() is True
    except Exception:
        logger.exception("Redis PING failed")
        return False
