"""Build API key usage dashboard payloads (JWT management UI)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pat_usage import derive_usage_status, read_usage_snapshot
from app.models.api_token import PersonalAccessToken
from app.models.audit import AuditLog

LIFECYCLE_ACTIONS = {
    "pat.created": "created",
    "pat.rotated": "rotated",
    "pat.revoked": "revoked",
    "pat.secret_acknowledged": "copied",
    "pat.route_denied": "failed",
    "pat.scope_denied": "failed",
}


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def build_token_usage(db: Session, record: PersonalAccessToken) -> dict[str, Any]:
    snap = read_usage_snapshot(record.id)
    status = derive_usage_status(
        revoked_at=record.revoked_at,
        expires_at=record.expires_at,
        requests_24h=int(snap["requests_24h"]),
        errors_24h=int(snap["errors_24h"]),
        last_success_at=snap.get("last_success_at"),
        last_fail_at=snap.get("last_fail_at"),
    )

    activity: list[dict[str, Any]] = []

    audits = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.target_type == "personal_access_token",
            AuditLog.target_id == str(record.id),
            AuditLog.action.in_(tuple(LIFECYCLE_ACTIONS.keys())),
        )
        .order_by(AuditLog.created_at.desc())
        .limit(40)
    ).all()

    for row in audits:
        event = LIFECYCLE_ACTIONS.get(row.action, row.action)
        detail = None
        data = row.data or {}
        if row.action == "pat.revoked":
            detail = f"reason={data.get('reason', 'immediate')}"
        elif row.action in ("pat.route_denied", "pat.scope_denied"):
            detail = f"{data.get('route', '')} ×{data.get('count', 1)}"
        elif row.action == "pat.rotated":
            detail = "new key issued"
        elif row.action == "pat.secret_acknowledged":
            detail = "secret saved acknowledgement"
        activity.append(
            {
                "at": _iso(row.created_at),
                "event": event,
                "detail": detail,
            }
        )

    # Also include rotated-from token's revoke if this is a rotation lineage tip
    if record.rotated_from_id:
        old_revokes = db.scalars(
            select(AuditLog)
            .where(
                AuditLog.target_type == "personal_access_token",
                AuditLog.target_id == str(record.rotated_from_id),
                AuditLog.action == "pat.revoked",
            )
            .order_by(AuditLog.created_at.desc())
            .limit(3)
        ).all()
        for row in old_revokes:
            activity.append(
                {
                    "at": _iso(row.created_at),
                    "event": "revoked",
                    "detail": f"previous key ({data_reason(row)})",
                }
            )

    for item in snap.get("timeline") or []:
        activity.append(
            {
                "at": item.get("at"),
                "event": item.get("event") or "used",
                "detail": item.get("detail"),
            }
        )

    activity = [a for a in activity if a.get("at")]
    activity.sort(key=lambda a: a["at"] or "", reverse=True)
    # Dedupe near-identical rows
    seen: set[tuple[str, str, str | None]] = set()
    deduped: list[dict[str, Any]] = []
    for row in activity:
        key = (row["at"], row["event"], row.get("detail"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
        if len(deduped) >= 30:
            break

    return {
        "token_id": record.id,
        "window": "24h",
        "requests_24h": snap["requests_24h"],
        "errors_24h": snap["errors_24h"],
        "rate_limited_24h": snap["rate_limited_24h"],
        "top_endpoint": snap["top_endpoint"],
        "last_used_at": record.last_used_at,
        "last_success_at": snap["last_success_at"],
        "last_success_route": snap["last_success_route"],
        "last_fail_at": snap["last_fail_at"],
        "last_fail_route": snap["last_fail_route"],
        "last_fail_status": snap["last_fail_status"],
        "last_ip": snap["last_ip"],
        "status": status,
        "metrics_available": snap["metrics_available"],
        "activity": deduped,
    }


def data_reason(row: AuditLog) -> str:
    data = row.data or {}
    return str(data.get("reason") or "revoked")
