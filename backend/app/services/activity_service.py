import uuid

from sqlalchemy.orm import Session

from app.models.activity import ActivityLog


def log_activity(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    action: str,
    actor_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    data: dict | None = None,
) -> ActivityLog:
    """Record a workspace/project activity entry. Caller commits."""
    entry = ActivityLog(
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        actor_id=actor_id,
        action=action,
        data=data or {},
    )
    db.add(entry)
    return entry
