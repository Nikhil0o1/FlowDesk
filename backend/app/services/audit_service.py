import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def audit(
    db: Session,
    action: str,
    *,
    organization_id: uuid.UUID | None = None,
    actor_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: Any = None,
    data: dict | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Record an audit event. Caller is responsible for commit."""
    entry = AuditLog(
        organization_id=organization_id,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        data=data or {},
        ip_address=ip_address,
    )
    db.add(entry)
    return entry
