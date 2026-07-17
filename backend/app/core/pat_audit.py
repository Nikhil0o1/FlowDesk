"""PAT security audit helpers — durable lifecycle + aggregated denials."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.redis_client import get_redis_client
from app.services.audit_service import audit

logger = logging.getLogger(__name__)

DENIAL_KEY_PREFIX = "fd:pat:denial:"
DENIAL_WINDOW_SECONDS = 300


def audit_pat_created(
    db: Session,
    *,
    actor_id: uuid.UUID,
    token_id: uuid.UUID,
    scopes: list[str],
    ip_address: str | None = None,
) -> None:
    audit(
        db,
        "pat.created",
        actor_id=actor_id,
        target_type="personal_access_token",
        target_id=token_id,
        data={"scopes": scopes},
        ip_address=ip_address,
    )


def audit_pat_rotated(
    db: Session,
    *,
    actor_id: uuid.UUID,
    new_token_id: uuid.UUID,
    old_token_id: uuid.UUID,
    scopes: list[str],
    ip_address: str | None = None,
) -> None:
    audit(
        db,
        "pat.rotated",
        actor_id=actor_id,
        target_type="personal_access_token",
        target_id=new_token_id,
        data={"rotated_from_id": str(old_token_id), "scopes": scopes},
        ip_address=ip_address,
    )


def audit_pat_revoked(
    db: Session,
    *,
    actor_id: uuid.UUID | None,
    token_id: uuid.UUID,
    reason: str = "immediate",
    ip_address: str | None = None,
) -> None:
    audit(
        db,
        "pat.revoked",
        actor_id=actor_id,
        target_type="personal_access_token",
        target_id=token_id,
        data={"reason": reason},
        ip_address=ip_address,
    )


def audit_pat_secret_acknowledged(
    db: Session,
    *,
    actor_id: uuid.UUID,
    token_id: uuid.UUID,
    ip_address: str | None = None,
) -> None:
    """User confirmed they saved the one-time secret (create/rotate). No secret stored."""
    audit(
        db,
        "pat.secret_acknowledged",
        actor_id=actor_id,
        target_type="personal_access_token",
        target_id=token_id,
        data={},
        ip_address=ip_address,
    )


def record_denial_aggregate(
    *,
    event: str,
    token_id: uuid.UUID | None,
    route: str,
    extra: dict[str, Any] | None = None,
) -> None:
    """Increment Redis aggregate for high-frequency denials (not one audit row per request)."""
    client = get_redis_client()
    tid = str(token_id) if token_id else "unknown"
    key = f"{DENIAL_KEY_PREFIX}{event}:{tid}:{route}"
    payload = {
        "event": event,
        "token_id": tid,
        "route": route,
        "extra": extra or {},
        "ts": time.time(),
    }
    if client is None:
        logger.info("pat_denial event=%s token=%s route=%s", event, tid, route)
        return
    try:
        pipe = client.pipeline()
        pipe.hincrby(key, "count", 1)
        pipe.hsetnx(key, "first_ts", str(payload["ts"]))
        pipe.hset(key, "last_ts", str(payload["ts"]))
        pipe.hset(key, "meta", json.dumps(payload["extra"]))
        pipe.expire(key, DENIAL_WINDOW_SECONDS * 2)
        pipe.execute()
    except Exception:
        logger.exception("Failed to record PAT denial aggregate")


def flush_denial_aggregates(db: Session) -> int:
    """Flush Redis denial aggregates into durable audit rows. Returns rows written."""
    client = get_redis_client()
    if client is None:
        return 0
    written = 0
    try:
        cursor = 0
        while True:
            cursor, keys = client.scan(cursor=cursor, match=f"{DENIAL_KEY_PREFIX}*", count=100)
            for key in keys:
                data = client.hgetall(key)
                if not data:
                    continue
                # key: fd:pat:denial:{event}:{token_id}:{route}
                parts = key.split(":", 4)
                if len(parts) < 5:
                    continue
                # fd pat denial event rest...
                remainder = key[len(DENIAL_KEY_PREFIX) :]
                event, _, rest = remainder.partition(":")
                token_id, _, route = rest.partition(":")
                count = int(data.get("count") or 0)
                if count <= 0:
                    continue
                try:
                    tid = uuid.UUID(token_id) if token_id != "unknown" else None
                except ValueError:
                    tid = None
                audit(
                    db,
                    event,
                    actor_id=None,
                    target_type="personal_access_token",
                    target_id=tid,
                    data={
                        "route": route,
                        "count": count,
                        "first_ts": data.get("first_ts"),
                        "last_ts": data.get("last_ts"),
                        "aggregated": True,
                    },
                )
                written += 1
                client.delete(key)
            if cursor == 0:
                break
        if written:
            db.commit()
    except Exception:
        logger.exception("Failed flushing PAT denial aggregates")
        db.rollback()
        return 0
    return written
