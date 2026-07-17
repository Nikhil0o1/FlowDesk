"""Persist MCP tool invocation audit events."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.api_token import PersonalAccessToken
from app.models.mcp_audit import McpToolInvocation


def log_invocation(
    db: Session,
    *,
    user_id: uuid.UUID,
    token_id: uuid.UUID | None,
    tool: str,
    args_hash: str,
    status: str,
    http_status: int | None = None,
    resource_ids: list[str] | None = None,
    error_message: str | None = None,
    duration_ms: int | None = None,
) -> McpToolInvocation:
    row = McpToolInvocation(
        user_id=user_id,
        token_id=token_id,
        tool=tool.strip()[:120],
        args_hash=args_hash[:64],
        status=status,
        http_status=http_status,
        resource_ids=[r[:64] for r in (resource_ids or [])[:25]],
        error_message=(error_message[:2000] if error_message else None),
        duration_ms=duration_ms,
    )
    db.add(row)
    db.flush()
    return row


def list_user_invocations(
    db: Session,
    user_id: uuid.UUID,
    *,
    limit: int = 50,
) -> list[tuple[McpToolInvocation, str | None]]:
    limit = max(1, min(limit, 200))
    rows = db.scalars(
        select(McpToolInvocation)
        .where(McpToolInvocation.user_id == user_id)
        .order_by(McpToolInvocation.created_at.desc())
        .limit(limit)
    ).all()
    token_ids = {r.token_id for r in rows if r.token_id}
    prefixes: dict[uuid.UUID, str] = {}
    if token_ids:
        for tok in db.scalars(
            select(PersonalAccessToken).where(PersonalAccessToken.id.in_(token_ids))
        ).all():
            prefixes[tok.id] = tok.token_prefix
    return [(r, prefixes.get(r.token_id) if r.token_id else None) for r in rows]
