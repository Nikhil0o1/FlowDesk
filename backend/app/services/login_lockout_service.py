"""Per-email OTP verify lockout (issue #11)."""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.core.config import settings

_lock = threading.Lock()
# email -> (failed_count, lockout_until_monotonic | None)
_state: dict[str, tuple[int, float | None]] = {}


def _now_mono() -> float:
    return time.monotonic()


def assert_not_locked(email: str) -> None:
    """Raise 429 when the email is temporarily locked after repeated failures."""
    key = email.lower().strip()
    with _lock:
        entry = _state.get(key)
        if not entry:
            return
        _, lockout_until = entry
        if lockout_until and lockout_until > _now_mono():
            retry_after = int(lockout_until - _now_mono()) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed sign-in attempts. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )
        if lockout_until and lockout_until <= _now_mono():
            _state.pop(key, None)


def record_failed_attempt(email: str) -> None:
    key = email.lower().strip()
    with _lock:
        count, lockout_until = _state.get(key, (0, None))
        if lockout_until and lockout_until > _now_mono():
            return
        count += 1
        if count >= settings.OTP_LOCKOUT_ATTEMPTS:
            _state[key] = (count, _now_mono() + settings.OTP_LOCKOUT_MINUTES * 60)
        else:
            _state[key] = (count, None)


def clear_lockout(email: str) -> None:
    with _lock:
        _state.pop(email.lower().strip(), None)
