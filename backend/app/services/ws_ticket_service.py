"""Short-lived, single-use WebSocket connection tickets.

Prefer Redis (GETDEL) so any API worker can redeem. Falls back to process-local
memory when Redis is unset or unreachable (single-worker / local dev).
"""
from __future__ import annotations

import logging
import secrets
import threading
import time
import uuid

from app.core.config import settings

logger = logging.getLogger(__name__)

_KEY_PREFIX = "fd:ws:ticket:"
_lock = threading.Lock()
_tickets: dict[str, tuple[uuid.UUID, float]] = {}
_redeem_failures = 0
_redeem_failures_lock = threading.Lock()


def ticket_ttl() -> int:
    return int(settings.WS_TICKET_TTL_SECONDS)


def redeem_failure_count() -> int:
    with _redeem_failures_lock:
        return _redeem_failures


def _bump_redeem_failure() -> None:
    global _redeem_failures
    with _redeem_failures_lock:
        _redeem_failures += 1


def _purge_expired(now: float) -> None:
    expired = [ticket for ticket, (_, exp) in _tickets.items() if exp <= now]
    for ticket in expired:
        _tickets.pop(ticket, None)


def _issue_memory(user_id: uuid.UUID, ttl: int) -> str:
    ticket = secrets.token_urlsafe(32)
    now = time.time()
    with _lock:
        _purge_expired(now)
        _tickets[ticket] = (user_id, now + ttl)
    return ticket


def _redeem_memory(ticket: str) -> uuid.UUID | None:
    now = time.time()
    with _lock:
        _purge_expired(now)
        entry = _tickets.pop(ticket, None)
    if not entry:
        return None
    user_id, expires_at = entry
    if expires_at <= now:
        return None
    return user_id


def issue_ws_ticket(user_id: uuid.UUID) -> tuple[str, int]:
    """Return (ticket, expires_in_seconds)."""
    ttl = ticket_ttl()
    ticket = secrets.token_urlsafe(32)
    from app.core.redis_client import get_redis_client

    client = get_redis_client()
    if client is not None:
        try:
            client.setex(f"{_KEY_PREFIX}{ticket}", ttl, str(user_id))
            return ticket, ttl
        except Exception:
            logger.exception("Redis WS ticket issue failed — falling back to memory")

    # Memory path: use generated ticket via memory store
    with _lock:
        _purge_expired(time.time())
        _tickets[ticket] = (user_id, time.time() + ttl)
    return ticket, ttl


def redeem_ws_ticket(ticket: str) -> uuid.UUID | None:
    """Consume a ticket and return the user id, or None if invalid/expired."""
    if not ticket or not ticket.strip():
        _bump_redeem_failure()
        return None
    key = ticket.strip()
    from app.core.redis_client import get_redis_client

    client = get_redis_client()
    if client is not None:
        try:
            redis_key = f"{_KEY_PREFIX}{key}"
            # Atomic consume when available (Redis >= 6.2)
            getdel = getattr(client, "getdel", None)
            if callable(getdel):
                raw = getdel(redis_key)
            else:
                pipe = client.pipeline()
                pipe.get(redis_key)
                pipe.delete(redis_key)
                raw, _ = pipe.execute()
            if raw:
                try:
                    return uuid.UUID(str(raw))
                except ValueError:
                    _bump_redeem_failure()
                    return None
            # Miss in Redis — also try memory (mixed mode during rollout)
        except Exception:
            logger.exception("Redis WS ticket redeem failed — trying memory")

    user_id = _redeem_memory(key)
    if user_id is None:
        _bump_redeem_failure()
    return user_id
