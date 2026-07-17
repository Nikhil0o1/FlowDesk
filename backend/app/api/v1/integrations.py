"""Google Workspace integrations: status, Gmail-on-tasks, Sheets export,
live sync (one-way or two-way) and time tracking reports."""
import uuid
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.task_ref import format_task_ref
from app.db.session import get_db
from app.models.integration import GoogleSheetSync
from app.models.task import Task
from app.schemas.common import Message
from app.services import google_service
from app.services.audit_service import audit
from app.services.permission_service import PermissionService
from app.services.sheet_sync_service import build_project_rows, build_time_report, run_sync

router = APIRouter(tags=["integrations"])


# ---------------- Status ----------------

class GoogleScopes(BaseModel):
    calendar: bool
    gmail_send: bool
    gmail_read: bool
    sheets: bool


class GoogleStatus(BaseModel):
    configured: bool
    connected: bool
    account_email: str | None = None
    scopes: GoogleScopes


@router.get("/integrations/google/status", response_model=GoogleStatus)
def google_status(
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    connection = google_service.get_connection(db, perms.user.id)
    return GoogleStatus(
        configured=google_service.google_configured(),
        connected=connection is not None,
        account_email=connection.account_email if connection else None,
        scopes=GoogleScopes(
            calendar=google_service.has_scope(connection, google_service.SCOPE_CALENDAR),
            gmail_send=google_service.has_scope(connection, google_service.SCOPE_GMAIL_SEND),
            gmail_read=google_service.has_scope(connection, google_service.SCOPE_GMAIL_READ),
            sheets=google_service.has_scope(connection, google_service.SCOPE_SHEETS),
        ),
    )


# ---------------- Gmail on tasks ----------------

class TaskEmail(BaseModel):
    id: str
    subject: str
    sender: str
    date: str
    snippet: str
    link: str


class TaskEmailsOut(BaseModel):
    connected: bool
    emails: list[TaskEmail] = []


@router.get("/tasks/{task_id}/emails", response_model=TaskEmailsOut)
def task_emails(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """The caller's own Gmail messages mentioning this task's ref (e.g. PHX-12)."""
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_view(task.project_id)
    connection = google_service.get_connection(db, perms.user.id)
    if not google_service.has_scope(connection, google_service.SCOPE_GMAIL_READ):
        return TaskEmailsOut(connected=False)
    ref = format_task_ref(project.id, task.number)
    messages = google_service.gmail_search(db, connection, f'"{ref}"', limit=10)
    return TaskEmailsOut(connected=True, emails=[TaskEmail(**m) for m in messages])


# ---------------- Calendar: push a task's due date ----------------

class CalendarEventOut(BaseModel):
    link: str


@router.post("/tasks/{task_id}/calendar-event", response_model=CalendarEventOut)
def add_task_to_calendar(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Create an all-day event for the task's due date on the caller's Google Calendar."""
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_view(task.project_id)
    if not task.due_date:
        raise HTTPException(status_code=400, detail="Set a due date on the task first")
    connection = google_service.get_connection(db, perms.user.id)
    if not google_service.has_scope(connection, google_service.SCOPE_CALENDAR):
        raise HTTPException(
            status_code=412,
            detail="Connect your Google account (with calendar access) in the App Center first",
        )
    from app.core.config import settings

    ref = format_task_ref(project.id, task.number)
    result = google_service.calendar_create_event(
        db,
        connection,
        summary=f"{ref}: {task.title}",
        description=f"FlowDesk task {ref}\n{settings.FRONTEND_URL}/app/tasks/{task.id}",
        day=task.due_date,
    )
    if result.get("id"):
        task.google_calendar_event_id = result["id"]
        db.commit()
    return CalendarEventOut(link=result.get("link", ""))


# ---------------- Sheets export & live sync ----------------

class SheetExportOut(BaseModel):
    url: str


class SheetSyncStatus(BaseModel):
    enabled: bool
    mode: Literal["export", "two_way"] | None = None
    url: str | None = None
    last_synced_at: datetime | None = None


class SheetSyncToggle(BaseModel):
    enabled: bool
    mode: Literal["export", "two_way"] = "export"


def _require_sheets_connection(db: Session, perms: PermissionService):
    connection = google_service.get_connection(db, perms.user.id)
    if not google_service.has_scope(connection, google_service.SCOPE_SHEETS):
        raise HTTPException(
            status_code=412,
            detail="Connect your Google account (with Sheets access) in the App Center first",
        )
    return connection


@router.post("/projects/{project_id}/sheets/export", response_model=SheetExportOut)
def export_project_to_sheet(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """One-off export of the project's tasks to a new spreadsheet in the caller's Drive."""
    project = perms.require_project_view(project_id)
    connection = _require_sheets_connection(db, perms)
    spreadsheet_id, url = google_service.sheets_create(
        db, connection, f"{project.name} — FlowDesk export"
    )
    try:
        google_service.sheets_overwrite(db, connection, spreadsheet_id, build_project_rows(db, project))
    except google_service.GoogleConnectionExpired as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    ws = perms.get_workspace_or_404(project.workspace_id)
    audit(db, "sheets.exported", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="project", target_id=project.id, data={"spreadsheet_id": spreadsheet_id})
    db.commit()
    return SheetExportOut(url=url)


@router.get("/projects/{project_id}/sheets/sync", response_model=SheetSyncStatus)
def sheet_sync_status(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    sync = db.scalar(select(GoogleSheetSync).where(GoogleSheetSync.project_id == project_id))
    if not sync or not sync.is_active:
        return SheetSyncStatus(enabled=False)
    return SheetSyncStatus(enabled=True, mode=sync.sync_mode, url=sync.spreadsheet_url,
                           last_synced_at=sync.last_synced_at)


@router.post("/projects/{project_id}/sheets/sync", response_model=SheetSyncStatus)
def toggle_sheet_sync(
    project_id: uuid.UUID,
    body: SheetSyncToggle,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Enable/disable continuous syncing of this project with a Google Sheet
    (mode "export" mirrors one-way; "two_way" also applies sheet edits and new
    rows back to FlowDesk). Project admins only — the sheet is written with
    the enabler's Google account."""
    project = perms.require_project_admin(project_id)
    sync = db.scalar(select(GoogleSheetSync).where(GoogleSheetSync.project_id == project_id))

    if not body.enabled:
        if sync:
            sync.is_active = False
            db.commit()
        return SheetSyncStatus(enabled=False)

    connection = _require_sheets_connection(db, perms)
    if sync:
        sync.is_active = True
        sync.sync_mode = body.mode
        sync.connection_id = connection.id
        sync.created_by = perms.user.id
        # Edits made while the sync was off (or under another owner) have no
        # trustworthy baseline — drop the snapshot so the first cycle only
        # rewrites the sheet instead of applying stale diffs.
        sync.snapshot = None
    else:
        spreadsheet_id, url = google_service.sheets_create(
            db, connection, f"{project.name} — FlowDesk live sync"
        )
        sync = GoogleSheetSync(
            project_id=project_id,
            connection_id=connection.id,
            spreadsheet_id=spreadsheet_id,
            spreadsheet_url=url,
            sync_mode=body.mode,
            created_by=perms.user.id,
        )
        db.add(sync)
    db.flush()
    run_sync(db, sync)
    ws = perms.get_workspace_or_404(project.workspace_id)
    audit(db, "sheets.sync_enabled", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="project", target_id=project.id,
          data={"spreadsheet_id": sync.spreadsheet_id, "mode": sync.sync_mode})
    db.commit()
    return SheetSyncStatus(enabled=True, mode=sync.sync_mode, url=sync.spreadsheet_url,
                           last_synced_at=sync.last_synced_at)


@router.post("/projects/{project_id}/sheets/time-report", response_model=SheetExportOut)
def export_time_report(
    project_id: uuid.UUID,
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Export the project's tracked time to a new spreadsheet: an Entries tab
    with every completed time entry plus a Summary tab with totals by user and
    by task — ready to share with a client."""
    project = perms.require_project_view(project_id)
    connection = _require_sheets_connection(db, perms)
    entries, summary = build_time_report(db, project, start, end)
    spreadsheet_id, url = google_service.sheets_create(
        db, connection, f"{project.name} — Time report", tabs=["Entries", "Summary"]
    )
    google_service.sheets_write(db, connection, spreadsheet_id, "Entries!A1", entries)
    google_service.sheets_write(db, connection, spreadsheet_id, "Summary!A1", summary)
    ws = perms.get_workspace_or_404(project.workspace_id)
    audit(db, "sheets.time_report", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="project", target_id=project.id, data={"spreadsheet_id": spreadsheet_id})
    db.commit()
    return SheetExportOut(url=url)
