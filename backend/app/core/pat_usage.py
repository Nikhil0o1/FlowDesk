"""Per-PAT usage metrics (rolling 24h) for the API Keys support dashboard.

Recording never raises into the request path. Redis is preferred; memory fallback
is used when Redis is unset (tests / local). Production with Redis configured but
unreachable: recording is skipped; reads report metrics_available=False.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from app.core.redis_client import get_redis_client

logger = logging.getLogger(__name__)

KEY_PREFIX = "fd:pat:usage:"
WINDOW_SECONDS = 86_400
TIMELINE_MAX = 50
ENDPOINT_SCAN_MAX = 200

_memory_lock = Lock()
_memory_counters: dict[str, list[float]] = defaultdict(list)
_memory_meta: dict[str, dict[str, str]] = defaultdict(dict)
_memory_endpoints: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
_memory_timeline: dict[str, list[dict[str, Any]]] = defaultdict(list)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tid(token_id: uuid.UUID) -> str:
    return str(token_id)


def _req_key(tid: str) -> str:
    return f"{KEY_PREFIX}{tid}:req"


def _err_key(tid: str) -> str:
    return f"{KEY_PREFIX}{tid}:err"


def _rl_key(tid: str) -> str:
    return f"{KEY_PREFIX}{tid}:429"


def _ep_key(tid: str, route: str) -> str:
    # Collapse whitespace; keep path template characters
    safe = route.replace(" ", "")[:200]
    return f"{KEY_PREFIX}{tid}:ep:{safe}"


def _meta_key(tid: str) -> str:
    return f"{KEY_PREFIX}{tid}:meta"


def _timeline_key(tid: str) -> str:
    return f"{KEY_PREFIX}{tid}:timeline"


def _trim_memory_bucket(bucket: list[float], now: float) -> list[float]:
    cutoff = now - WINDOW_SECONDS
    return [t for t in bucket if t >= cutoff]


def _incr_memory_counter(key: str) -> None:
    now = time.monotonic()
    with _memory_lock:
        _memory_counters[key] = _trim_memory_bucket(_memory_counters[key], now)
        _memory_counters[key].append(now)


def _count_memory(key: str) -> int:
    now = time.monotonic()
    with _memory_lock:
        _memory_counters[key] = _trim_memory_bucket(_memory_counters[key], now)
        return len(_memory_counters[key])


def _allow_memory_fallback() -> bool:
    from app.core.config import settings

    return not settings.is_production or not settings.redis_enabled


def metrics_store_available() -> bool:
    """True when we can read meaningful usage counters."""
    client = get_redis_client()
    if client is not None:
        try:
            client.ping()
            return True
        except Exception:
            return _allow_memory_fallback()
    return _allow_memory_fallback()


def record_pat_usage(
    *,
    token_id: uuid.UUID,
    route: str,
    status_code: int,
    ip_address: str | None = None,
    event: str | None = None,
) -> None:
    """Record one finished PAT request. Fail-soft."""
    try:
        tid = _tid(token_id)
        route = route or "unknown"
        is_success = 200 <= status_code < 400
        is_429 = status_code == 429
        is_error = status_code >= 400
        ts = _now_iso()
        timeline_event = event or ("used" if is_success else ("rate_limited" if is_429 else "failed"))

        client = get_redis_client()
        if client is not None:
            try:
                pipe = client.pipeline()
                pipe.incr(_req_key(tid))
                pipe.expire(_req_key(tid), WINDOW_SECONDS)
                if is_error:
                    pipe.incr(_err_key(tid))
                    pipe.expire(_err_key(tid), WINDOW_SECONDS)
                if is_429:
                    pipe.incr(_rl_key(tid))
                    pipe.expire(_rl_key(tid), WINDOW_SECONDS)
                ep = _ep_key(tid, route)
                pipe.incr(ep)
                pipe.expire(ep, WINDOW_SECONDS)
                meta_updates: dict[str, str] = {"last_ip": ip_address or ""}
                if is_success:
                    meta_updates.update(
                        {
                            "last_success_at": ts,
                            "last_success_route": route,
                        }
                    )
                else:
                    meta_updates.update(
                        {
                            "last_fail_at": ts,
                            "last_fail_route": route,
                            "last_fail_status": str(status_code),
                        }
                    )
                for field, value in meta_updates.items():
                    if value:
                        pipe.hset(_meta_key(tid), field, value)
                pipe.expire(_meta_key(tid), WINDOW_SECONDS)
                entry = json.dumps(
                    {
                        "at": ts,
                        "event": timeline_event,
                        "detail": f"{status_code} {route}",
                        "status_code": status_code,
                        "route": route,
                    }
                )
                pipe.lpush(_timeline_key(tid), entry)
                pipe.ltrim(_timeline_key(tid), 0, TIMELINE_MAX - 1)
                pipe.expire(_timeline_key(tid), WINDOW_SECONDS)
                pipe.execute()
                return
            except Exception:
                logger.exception("PAT usage Redis write failed")
                if not _allow_memory_fallback():
                    return

        if not _allow_memory_fallback():
            return

        _incr_memory_counter(_req_key(tid))
        if is_error:
            _incr_memory_counter(_err_key(tid))
        if is_429:
            _incr_memory_counter(_rl_key(tid))
        now = time.monotonic()
        with _memory_lock:
            bucket = _trim_memory_bucket(_memory_endpoints[tid][route], now)
            bucket.append(now)
            _memory_endpoints[tid][route] = bucket
            meta = _memory_meta[tid]
            if ip_address:
                meta["last_ip"] = ip_address
            if is_success:
                meta["last_success_at"] = ts
                meta["last_success_route"] = route
            else:
                meta["last_fail_at"] = ts
                meta["last_fail_route"] = route
                meta["last_fail_status"] = str(status_code)
            tl = _memory_timeline[tid]
            tl.insert(
                0,
                {
                    "at": ts,
                    "event": timeline_event,
                    "detail": f"{status_code} {route}",
                    "status_code": status_code,
                    "route": route,
                },
            )
            del tl[TIMELINE_MAX:]
    except Exception:
        logger.exception("PAT usage record failed")


def derive_usage_status(
    *,
    revoked_at: datetime | None,
    expires_at: datetime | None,
    requests_24h: int,
    errors_24h: int,
    last_success_at: str | None,
    last_fail_at: str | None,
    now: datetime | None = None,
) -> str:
    now = now or datetime.now(timezone.utc)
    if revoked_at is not None:
        return "revoked"
    if expires_at is not None and expires_at <= now:
        return "expired"
    if requests_24h == 0 and not last_success_at and not last_fail_at:
        return "idle"
    if last_fail_at and not last_success_at:
        return "failing"
    if last_fail_at and last_success_at:
        try:
            fail_t = datetime.fromisoformat(last_fail_at)
            ok_t = datetime.fromisoformat(last_success_at)
            if fail_t > ok_t and requests_24h > 0 and errors_24h / max(requests_24h, 1) >= 0.5:
                return "failing"
        except ValueError:
            pass
    if requests_24h >= 20 and errors_24h / requests_24h > 0.05:
        return "degraded"
    return "healthy"


def _top_endpoint_redis(client: Any, tid: str) -> str | None:
    best_route = None
    best_count = 0
    pattern = f"{KEY_PREFIX}{tid}:ep:*"
    cursor = 0
    scanned = 0
    while scanned < ENDPOINT_SCAN_MAX:
        cursor, keys = client.scan(cursor=cursor, match=pattern, count=50)
        for key in keys:
            scanned += 1
            try:
                count = int(client.get(key) or 0)
            except Exception:
                continue
            route = key.split(":ep:", 1)[-1]
            if count > best_count:
                best_count = count
                best_route = route
        if cursor == 0:
            break
    return best_route


def read_usage_snapshot(token_id: uuid.UUID) -> dict[str, Any]:
    """Return raw counters + meta + redis timeline. Does not include audit merge."""
    tid = _tid(token_id)
    available = metrics_store_available()
    empty = {
        "requests_24h": 0,
        "errors_24h": 0,
        "rate_limited_24h": 0,
        "top_endpoint": None,
        "last_success_at": None,
        "last_success_route": None,
        "last_fail_at": None,
        "last_fail_route": None,
        "last_fail_status": None,
        "last_ip": None,
        "metrics_available": available,
        "timeline": [],
    }
    if not available:
        empty["metrics_available"] = False
        return empty

    client = get_redis_client()
    if client is not None:
        try:
            req = int(client.get(_req_key(tid)) or 0)
            err = int(client.get(_err_key(tid)) or 0)
            rl = int(client.get(_rl_key(tid)) or 0)
            meta = client.hgetall(_meta_key(tid)) or {}
            raw_tl = client.lrange(_timeline_key(tid), 0, TIMELINE_MAX - 1) or []
            timeline = []
            for row in raw_tl:
                try:
                    timeline.append(json.loads(row))
                except (TypeError, json.JSONDecodeError):
                    continue
            last_fail_status = meta.get("last_fail_status")
            return {
                "requests_24h": req,
                "errors_24h": err,
                "rate_limited_24h": rl,
                "top_endpoint": _top_endpoint_redis(client, tid),
                "last_success_at": meta.get("last_success_at") or None,
                "last_success_route": meta.get("last_success_route") or None,
                "last_fail_at": meta.get("last_fail_at") or None,
                "last_fail_route": meta.get("last_fail_route") or None,
                "last_fail_status": int(last_fail_status) if last_fail_status else None,
                "last_ip": meta.get("last_ip") or None,
                "metrics_available": True,
                "timeline": timeline,
            }
        except Exception:
            logger.exception("PAT usage Redis read failed")
            if not _allow_memory_fallback():
                empty["metrics_available"] = False
                return empty

    with _memory_lock:
        now = time.monotonic()
        req_bucket = _trim_memory_bucket(_memory_counters.get(_req_key(tid), []), now)
        err_bucket = _trim_memory_bucket(_memory_counters.get(_err_key(tid), []), now)
        rl_bucket = _trim_memory_bucket(_memory_counters.get(_rl_key(tid), []), now)
        _memory_counters[_req_key(tid)] = req_bucket
        _memory_counters[_err_key(tid)] = err_bucket
        _memory_counters[_rl_key(tid)] = rl_bucket
        req = len(req_bucket)
        err = len(err_bucket)
        rl = len(rl_bucket)
        meta = dict(_memory_meta.get(tid, {}))
        eps = _memory_endpoints.get(tid, {})
        top = None
        top_n = 0
        for route, bucket in eps.items():
            n = len(_trim_memory_bucket(bucket, now))
            if n > top_n:
                top_n = n
                top = route
        timeline = list(_memory_timeline.get(tid, []))
        last_fail_status = meta.get("last_fail_status")
        return {
            "requests_24h": req,
            "errors_24h": err,
            "rate_limited_24h": rl,
            "top_endpoint": top,
            "last_success_at": meta.get("last_success_at"),
            "last_success_route": meta.get("last_success_route"),
            "last_fail_at": meta.get("last_fail_at"),
            "last_fail_route": meta.get("last_fail_route"),
            "last_fail_status": int(last_fail_status) if last_fail_status else None,
            "last_ip": meta.get("last_ip") or None,
            "metrics_available": True,
            "timeline": timeline,
        }


def clear_usage_memory_for_tests() -> None:
    """Test helper only."""
    with _memory_lock:
        _memory_counters.clear()
        _memory_meta.clear()
        _memory_endpoints.clear()
        _memory_timeline.clear()
