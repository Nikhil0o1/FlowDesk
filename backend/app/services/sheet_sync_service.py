"""Project <-> Google Sheet syncing (API + cron) and time report exports.

One-way ("export") syncs mirror FlowDesk to the sheet. Two-way syncs first read
the sheet back: cells edited since the last export are applied to the matching
tasks (sheet wins for those cells), and rows added without a Ref become new
tasks. The sheet is then rewritten from the database, so FlowDesk stays the
source of truth for everything not edited in the sheet.
"""
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.calendar import CalendarConnection
from app.models.integration import GoogleSheetSync
from app.models.project import Project
from app.models.task import TASK_PRIORITIES, TASK_TYPES, CustomStatus, Task, TaskAssignee
from app.models.time_entry import TimeEntry
from app.models.user import Profile, User
from app.models.workspace import WorkspaceMember
from app.services import google_service, task_service

logger = logging.getLogger(__name__)

HEADER = ["Ref", "Title", "Status", "Type", "Priority", "Story points",
          "Assignees", "Labels", "Due date", "Completed", "Created"]

# Columns applied back to tasks in two-way mode (Assignees only on new rows;
# Ref/Completed/Created are derived and never read back).
EDITABLE = ["Title", "Status", "Type", "Priority", "Story points", "Labels", "Due date"]


def build_project_rows(db: Session, project: Project) -> list[list]:
    tasks = db.scalars(
        select(Task)
        .where(Task.project_id == project.id, Task.deleted_at.is_(None),
               Task.is_archived.is_(False), Task.parent_task_id.is_(None))
        .order_by(Task.number)
    ).all()
    statuses = {s.id: s.name for s in db.scalars(
        select(CustomStatus).where(CustomStatus.project_id == project.id)
    ).all()}
    names = dict(db.execute(select(Profile.user_id, Profile.full_name)).all())
    assignees: dict = {}
    for ta in db.scalars(select(TaskAssignee)).all():
        assignees.setdefault(ta.task_id, []).append(names.get(ta.user_id) or "")

    rows: list[list] = [HEADER]
    for t in tasks:
        rows.append([
            f"{project.key}-{t.number}",
            t.title,
            statuses.get(t.status_id, ""),
            t.task_type,
            t.priority or "",
            t.story_points if t.story_points is not None else "",
            ", ".join(filter(None, assignees.get(t.id, []))),
            ", ".join(t.labels or []),
            t.due_date.isoformat() if t.due_date else "",
            "yes" if t.completed_at else "",
            t.created_at.date().isoformat() if t.created_at else "",
        ])
    return rows


# ---------------- Two-way: apply sheet edits back to tasks ----------------

def _norm(value) -> str:
    return str(value).strip() if value is not None else ""


def _apply_cell(db: Session, task: Task, column: str, raw: str,
                status_by_name: dict[str, CustomStatus]) -> bool:
    """Apply one edited sheet cell to a task. Unparseable values are ignored."""
    value = raw.strip()
    if column == "Title":
        if value and value[:500] != task.title:
            task.title = value[:500]
            return True
    elif column == "Status":
        status = status_by_name.get(value.lower())
        if status:
            return task_service.apply_status_change(db, task, status.id)
    elif column == "Type":
        if value.lower() in TASK_TYPES and value.lower() != task.task_type:
            task.task_type = value.lower()
            return True
    elif column == "Priority":
        if value and value.lower() not in TASK_PRIORITIES:
            return False
        new = value.lower() or None
        if new != task.priority:
            task.priority = new
            return True
    elif column == "Story points":
        try:
            new = int(float(value)) if value else None
        except ValueError:
            return False
        if new != task.story_points:
            task.story_points = new
            return True
    elif column == "Labels":
        new = [p.strip() for p in value.split(",") if p.strip()]
        if new != (task.labels or []):
            task.labels = new
            return True
    elif column == "Due date":
        try:
            new = date.fromisoformat(value) if value else None
        except ValueError:
            return False
        if new != task.due_date:
            task.due_date = new
            return True
    return False


def _workspace_user_lookup(db: Session, workspace_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """Map lowercase full names and emails of workspace members to user ids."""
    member_ids = db.scalars(
        select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)
    ).all()
    if not member_ids:
        return {}
    lookup: dict[str, uuid.UUID] = {}
    for user in db.scalars(select(User).where(User.id.in_(member_ids))).all():
        lookup[user.email.lower()] = user.id
    for profile in db.scalars(select(Profile).where(Profile.user_id.in_(member_ids))).all():
        if profile.full_name:
            lookup[profile.full_name.lower()] = profile.user_id
    return lookup


def _create_task_from_row(db: Session, sync: GoogleSheetSync, project: Project,
                          cells: dict[str, str], status_by_name: dict[str, CustomStatus],
                          user_lookup: dict[str, uuid.UUID]) -> Task:
    status = status_by_name.get(cells["Status"].lower())
    number = task_service.claim_task_number(db, project.id)
    task = Task(
        project_id=project.id,
        number=number,
        title=cells["Title"][:500],
        status_id=status.id if status else task_service.default_status_id(db, project.id),
        created_by=sync.created_by,
    )
    db.add(task)
    db.flush()
    for column in ("Type", "Priority", "Story points", "Labels", "Due date"):
        _apply_cell(db, task, column, cells[column], status_by_name)
    if status and status.category == "done":
        task.completed_at = datetime.now(timezone.utc)

    assignee_ids = [user_lookup[p.strip().lower()] for p in cells["Assignees"].split(",")
                    if p.strip().lower() in user_lookup]
    actor = db.get(User, sync.created_by)
    if assignee_ids and actor:
        task_service.assign_users(db, task, project, assignee_ids, actor, notify_users=True)
    return task


def apply_sheet_edits(db: Session, sync: GoogleSheetSync, project: Project,
                      sheet_rows: list[list]) -> tuple[int, int]:
    """Inbound pass of a two-way sync. Returns (tasks_updated, tasks_created).

    Only cells that differ from the snapshot of the last export are applied, so
    stale sheet data never reverts changes made in FlowDesk between syncs.
    """
    if not sheet_rows:
        return 0, 0
    columns: dict[str, int] = {}
    for i, cell in enumerate(sheet_rows[0]):
        columns.setdefault(_norm(cell), i)
    if any(name not in columns for name in HEADER):
        logger.warning("Sheet %s header was modified; skipping inbound sync", sync.spreadsheet_id)
        return 0, 0

    snapshot: dict[str, list] = sync.snapshot or {}
    statuses = db.scalars(
        select(CustomStatus).where(CustomStatus.project_id == project.id)
    ).all()
    status_by_name = {s.name.lower(): s for s in statuses}
    tasks_by_ref = {
        f"{project.key}-{t.number}": t
        for t in db.scalars(
            select(Task).where(Task.project_id == project.id, Task.deleted_at.is_(None),
                               Task.is_archived.is_(False), Task.parent_task_id.is_(None))
        ).all()
    }
    user_lookup = _workspace_user_lookup(db, project.workspace_id)

    updated = created = 0
    for row in sheet_rows[1:]:
        cells = {}
        for name in HEADER:
            idx = columns[name]
            cells[name] = _norm(row[idx]) if idx < len(row) else ""
        ref = cells["Ref"]

        if not ref:
            if not cells["Title"]:
                continue
            task = _create_task_from_row(db, sync, project, cells, status_by_name, user_lookup)
            task_service.emit_task_event("task.created", db, project, task, {"source": "google_sheet"})
            task_service.log_task_activity(db, project, task, "task.created", sync.created_by,
                                           {"source": "google_sheet"})
            created += 1
            continue

        task = tasks_by_ref.get(ref)
        base = snapshot.get(ref)
        if task is None or base is None:
            # Unknown ref (deleted task / typo) or no baseline yet — the
            # rewrite that follows will normalize the row.
            continue
        changed_fields = []
        for column in EDITABLE:
            idx = HEADER.index(column)
            base_value = _norm(base[idx]) if idx < len(base) else ""
            if cells[column] != base_value and _apply_cell(db, task, column, cells[column], status_by_name):
                changed_fields.append(column)
        if changed_fields:
            task_service.emit_task_event("task.updated", db, project, task, {"source": "google_sheet"})
            task_service.log_task_activity(db, project, task, "task.updated", sync.created_by,
                                           {"source": "google_sheet", "fields": changed_fields})
            updated += 1
    if updated or created:
        db.flush()
    return updated, created


# ---------------- Sync runner (API + cron) ----------------

def run_sync(db: Session, sync: GoogleSheetSync) -> bool:
    """Run one sync cycle for a project. Returns True on success."""
    project = db.get(Project, sync.project_id)
    connection = db.get(CalendarConnection, sync.connection_id)
    if not project or project.deleted_at is not None or not connection:
        sync.is_active = False
        db.commit()
        return False
    if sync.sync_mode == "two_way":
        sheet_rows = google_service.sheets_read(db, connection, sync.spreadsheet_id)
        updated, created = apply_sheet_edits(db, sync, project, sheet_rows)
        if updated or created:
            logger.info("Sheet sync %s: applied %d updates, created %d tasks",
                        sync.spreadsheet_id, updated, created)
    rows = build_project_rows(db, project)
    google_service.sheets_overwrite(db, connection, sync.spreadsheet_id, rows)
    sync.snapshot = {str(row[0]): [_norm(c) for c in row] for row in rows[1:]}
    sync.last_synced_at = datetime.now(timezone.utc)
    db.commit()
    return True


# ---------------- Time tracking report ----------------

TIME_HEADER = ["Date", "Ref", "Task", "User", "Description", "Hours", "Manual entry", "Started", "Ended"]


def build_time_report(db: Session, project: Project,
                      start: date | None = None, end: date | None = None) -> tuple[list[list], list[list]]:
    """Rows for a time report: (entries tab, summary tab with per-user and per-task totals)."""
    query = (
        select(TimeEntry, Task)
        .join(Task, TimeEntry.task_id == Task.id)
        .where(Task.project_id == project.id, Task.deleted_at.is_(None),
               TimeEntry.ended_at.is_not(None))
        .order_by(TimeEntry.started_at)
    )
    if start:
        query = query.where(TimeEntry.started_at >= datetime(start.year, start.month, start.day, tzinfo=timezone.utc))
    if end:  # inclusive end date
        query = query.where(
            TimeEntry.started_at < datetime(end.year, end.month, end.day, tzinfo=timezone.utc) + timedelta(days=1)
        )
    pairs = db.execute(query).all()
    names = dict(db.execute(select(Profile.user_id, Profile.full_name)).all())

    entries: list[list] = [TIME_HEADER]
    by_user: dict[str, float] = {}
    by_task: dict[str, tuple[str, float]] = {}
    total = 0.0
    for entry, task in pairs:
        hours = round((entry.duration_seconds or 0) / 3600, 2)
        ref = f"{project.key}-{task.number}"
        user = names.get(entry.user_id) or ""
        entries.append([
            entry.started_at.date().isoformat(),
            ref,
            task.title,
            user,
            entry.description or "",
            hours,
            "yes" if entry.is_manual else "",
            entry.started_at.isoformat(timespec="minutes"),
            entry.ended_at.isoformat(timespec="minutes") if entry.ended_at else "",
        ])
        total += hours
        by_user[user] = by_user.get(user, 0.0) + hours
        by_task[ref] = (task.title, by_task.get(ref, ("", 0.0))[1] + hours)

    summary: list[list] = [["Time report", project.name]]
    summary.append(["Period", f"{start.isoformat() if start else 'start'} - {end.isoformat() if end else 'today'}"])
    summary.append(["Total hours", round(total, 2)])
    summary.append([])
    summary.append(["By user", "Hours"])
    for user, hours in sorted(by_user.items(), key=lambda kv: -kv[1]):
        summary.append([user or "(unknown)", round(hours, 2)])
    summary.append([])
    summary.append(["By task", "Title", "Hours"])
    for ref, (title, hours) in sorted(by_task.items(), key=lambda kv: -kv[1][1]):
        summary.append([ref, title, round(hours, 2)])
    return entries, summary
