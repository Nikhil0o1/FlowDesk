"""Guards for unauthenticated public resource endpoints (issue #13)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import Organization
from app.models.project import Project
from app.models.task import Task
from app.models.workspace import Workspace


def _now() -> datetime:
    return datetime.now(timezone.utc)


def resolve_public_task(db: Session, token: str) -> tuple[Task, Project]:
    """Load a publicly shared task and verify the full parent chain is active."""
    task = db.scalar(select(Task).where(Task.public_token == token, Task.deleted_at.is_(None)))
    if not task or not task.public_enabled:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.public_expires_at and task.public_expires_at < _now():
        raise HTTPException(status_code=404, detail="This share link has expired")

    project = db.get(Project, task.project_id)
    if not project or project.deleted_at is not None or project.is_archived:
        raise HTTPException(status_code=404, detail="Task not found")

    workspace = db.get(Workspace, project.workspace_id)
    if not workspace or workspace.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")

    org = db.get(Organization, workspace.organization_id)
    if not org or org.is_disabled or org.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")

    return task, project


def public_assignee_display(full_name: str | None, user_id: uuid.UUID) -> dict:
    """Return assignee info safe for anonymous public viewers (no email)."""
    name = (full_name or "").strip() or "Team member"
    return {"display_name": name}
