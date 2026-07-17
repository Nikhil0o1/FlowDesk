"""Push FlowDesk tasks to the user's Google Calendar and keep them in sync."""
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.project import Project
from app.core.task_ref import format_task_ref
from app.models.task import Task
from app.models.user import User
from app.services import google_service


def _summary(project: Project, task: Task) -> str:
    return f"{format_task_ref(project.id, task.number)}: {task.title}"


def _description(task_id: uuid.UUID) -> str:
    return f"FlowDesk task\n{settings.FRONTEND_URL}/app/tasks/{task_id}"


def _require_connection(db: Session, user: User):
    connection = google_service.get_connection(db, user.id)
    if not google_service.has_scope(connection, google_service.SCOPE_CALENDAR):
        raise HTTPException(
            status_code=412,
            detail="Re-connect your Google account in the App Center to allow calendar sync",
        )
    return connection


def push_task(db: Session, user: User, project: Project, task: Task) -> str | None:
    """Create a Google Calendar event for a task. Returns the event html link."""
    connection = _require_connection(db, user)
    summary = _summary(project, task)
    description = _description(task.id)

    if task.planned_start_at and task.planned_end_at:
        result = google_service.calendar_create_timed_event(
            db,
            connection,
            summary=summary,
            description=description,
            start_at=task.planned_start_at,
            end_at=task.planned_end_at,
        )
    elif task.due_date:
        result = google_service.calendar_create_event(
            db, connection, summary=summary, description=description, day=task.due_date,
        )
    else:
        return None

    task.google_calendar_event_id = result["id"] or None
    db.flush()
    return result.get("link") or None


def refresh_task(db: Session, user: User, project: Project, task: Task) -> None:
    """Update the linked Google Calendar event when the task changes."""
    if not task.google_calendar_event_id:
        return
    connection = google_service.get_connection(db, user.id)
    if not google_service.has_scope(connection, google_service.SCOPE_CALENDAR):
        return
    google_service.calendar_update_event(
        db,
        connection,
        event_id=task.google_calendar_event_id,
        summary=_summary(project, task),
        description=_description(task.id),
        start_at=task.planned_start_at,
        end_at=task.planned_end_at,
        day=task.due_date if not task.planned_start_at else None,
    )


def remove_task(db: Session, user: User, task: Task) -> None:
    """Delete the linked Google Calendar event when a task is removed."""
    if not task.google_calendar_event_id:
        return
    connection = google_service.get_connection(db, user.id)
    if google_service.has_scope(connection, google_service.SCOPE_CALENDAR):
        try:
            google_service.calendar_delete_event(
                db, connection, event_id=task.google_calendar_event_id,
            )
        except HTTPException:
            pass
    task.google_calendar_event_id = None
