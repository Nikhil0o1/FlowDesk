import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.core.websocket import emit
from app.db.session import get_db
from app.models.project import Project
from app.models.task import Task
from app.models.time_entry import TimeEntry
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.time_entry import ManualTimeEntry, TimeEntryOut, TimerStart
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["time-tracking"])


def _entry_out(db: Session, entry: TimeEntry, with_task: bool = False) -> TimeEntryOut:
    out = TimeEntryOut.model_validate(entry)
    out.user = user_briefs(db, [entry.user_id]).get(entry.user_id)
    if with_task:
        task = db.get(Task, entry.task_id)
        if task:
            out.task_title = task.title
            project = db.get(Project, task.project_id)
            if project:
                out.task_ref = f"{project.key}-{task.number}"
    return out


def _get_task_with_access(db: Session, perms: PermissionService, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_project_view(task.project_id)
    return task


@router.post("/tasks/{task_id}/timer/start", response_model=TimeEntryOut, status_code=201)
def start_timer(
    task_id: uuid.UUID,
    body: TimerStart,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = _get_task_with_access(db, perms, task_id)
    running = db.scalar(
        select(TimeEntry).where(
            TimeEntry.user_id == perms.user.id, TimeEntry.ended_at.is_(None)
        )
    )
    if running:
        raise HTTPException(
            status_code=409,
            detail="You already have a running timer. Stop it before starting a new one.",
        )
    entry = TimeEntry(
        task_id=task_id,
        user_id=perms.user.id,
        started_at=datetime.now(timezone.utc),
        description=body.description,
    )
    db.add(entry)
    db.flush()
    project = db.get(Project, task.project_id)
    emit(
        "timer.started",
        [f"user:{perms.user.id}", f"project:{task.project_id}"],
        payload={"time_entry_id": str(entry.id), "task_id": str(task_id),
                 "user_id": str(perms.user.id), "started_at": entry.started_at.isoformat()},
        project_id=task.project_id,
        workspace_id=project.workspace_id if project else None,
    )
    db.commit()
    return _entry_out(db, entry, with_task=True)


@router.post("/timer/stop", response_model=TimeEntryOut)
def stop_timer(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = db.scalar(
        select(TimeEntry).where(TimeEntry.user_id == user.id, TimeEntry.ended_at.is_(None))
    )
    if not entry:
        raise HTTPException(status_code=404, detail="No running timer")
    entry.ended_at = datetime.now(timezone.utc)
    entry.duration_seconds = int((entry.ended_at - entry.started_at).total_seconds())
    task = db.get(Task, entry.task_id)
    project = db.get(Project, task.project_id) if task else None
    emit(
        "timer.stopped",
        [f"user:{user.id}"] + ([f"project:{task.project_id}"] if task else []),
        payload={"time_entry_id": str(entry.id), "task_id": str(entry.task_id),
                 "user_id": str(user.id), "duration_seconds": entry.duration_seconds},
        project_id=task.project_id if task else None,
        workspace_id=project.workspace_id if project else None,
    )
    db.commit()
    return _entry_out(db, entry, with_task=True)


@router.get("/timer/current", response_model=TimeEntryOut | None)
def current_timer(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    entry = db.scalar(
        select(TimeEntry).where(TimeEntry.user_id == user.id, TimeEntry.ended_at.is_(None))
    )
    return _entry_out(db, entry, with_task=True) if entry else None


@router.post("/tasks/{task_id}/time-entries", response_model=TimeEntryOut, status_code=201)
def add_manual_entry(
    task_id: uuid.UUID,
    body: ManualTimeEntry,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    _get_task_with_access(db, perms, task_id)
    entry = TimeEntry(
        task_id=task_id,
        user_id=perms.user.id,
        started_at=body.started_at,
        ended_at=body.ended_at,
        duration_seconds=int((body.ended_at - body.started_at).total_seconds()),
        description=body.description,
        is_manual=True,
    )
    db.add(entry)
    db.commit()
    return _entry_out(db, entry, with_task=True)


@router.get("/tasks/{task_id}/time-entries", response_model=Page[TimeEntryOut])
def task_time_entries(
    task_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    _get_task_with_access(db, perms, task_id)
    base = select(TimeEntry).where(TimeEntry.task_id == task_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(TimeEntry.started_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(
        items=[_entry_out(db, e) for e in rows], total=total, page=page, page_size=page_size
    )


@router.get("/me/time-entries", response_model=Page[TimeEntryOut])
def my_time_entries(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    base = select(TimeEntry).where(TimeEntry.user_id == user.id)
    if start:
        base = base.where(TimeEntry.started_at >= start)
    if end:
        base = base.where(TimeEntry.started_at < end)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(TimeEntry.started_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(
        items=[_entry_out(db, e, with_task=True) for e in rows],
        total=total, page=page, page_size=page_size,
    )


@router.delete("/time-entries/{entry_id}", response_model=Message)
def delete_time_entry(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    entry = db.get(TimeEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Time entry not found")
    if entry.user_id != perms.user.id:
        task = db.get(Task, entry.task_id)
        perms.require_project_admin(task.project_id)
    db.delete(entry)
    db.commit()
    return Message(detail="Time entry deleted")
