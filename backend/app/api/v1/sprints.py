import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.config import settings
from app.core.websocket import emit
from app.db.session import get_db
from app.models.sprint import Sprint, SprintTask, StandupUpdate
from app.models.task import Task
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.schemas.common import Message, Page
from app.schemas.sprint import (
    BurndownPoint,
    SprintBurndownOut,
    SprintCompleteRequest,
    SprintCreate,
    SprintOut,
    SprintTaskAdd,
    SprintUpdate,
    StandupCreate,
    StandupOut,
)
from app.schemas.task import TaskOut
from app.services import email_service, task_service
from app.services.activity_service import log_activity
from app.services.notification_service import notify
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["sprints"])


def _sprint_points(db: Session, sprint_id: uuid.UUID) -> tuple[int, int, int]:
    """Returns (task_count, total_points, completed_points)."""
    rows = db.execute(
        select(Task.story_points, Task.completed_at)
        .join(SprintTask, SprintTask.task_id == Task.id)
        .where(SprintTask.sprint_id == sprint_id, Task.deleted_at.is_(None))
    ).all()
    total = sum(r[0] or 0 for r in rows)
    completed = sum(r[0] or 0 for r in rows if r[1] is not None)
    return len(rows), total, completed


def _sprint_out(db: Session, sprint: Sprint) -> SprintOut:
    out = SprintOut.model_validate(sprint)
    out.task_count, out.total_points, out.completed_points = _sprint_points(db, sprint.id)
    if sprint.scrum_master_id:
        out.scrum_master = user_briefs(db, [sprint.scrum_master_id]).get(sprint.scrum_master_id)
    return out


def _sprint_rooms(sprint: Sprint) -> list[str]:
    rooms = [f"workspace:{sprint.workspace_id}"]
    if sprint.project_id:
        rooms.append(f"project:{sprint.project_id}")
    return rooms


def _validate_scrum_master(db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Scrum master is a per-sprint facilitation role: any member of the sprint's
    workspace is eligible (it does NOT have to be an admin — that's the point:
    it grants run rights for this one sprint without broader admin powers)."""
    is_member = db.scalar(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if not is_member:
        raise HTTPException(
            status_code=422,
            detail="Scrum master must be a member of this workspace",
        )


def _emit_sprint(sprint: Sprint, payload: dict | None = None) -> None:
    emit(
        "sprint.updated",
        _sprint_rooms(sprint),
        payload={"sprint_id": str(sprint.id), "status": sprint.status, **(payload or {})},
        workspace_id=sprint.workspace_id,
        project_id=sprint.project_id,
    )


@router.get("/workspaces/{workspace_id}/sprints", response_model=list[SprintOut])
def list_sprints(
    workspace_id: uuid.UUID,
    project_id: uuid.UUID | None = None,
    status: str | None = Query(default=None, pattern="^(planned|active|completed)$"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    query = select(Sprint).where(Sprint.workspace_id == workspace_id, Sprint.deleted_at.is_(None))
    if project_id:
        query = query.where(Sprint.project_id == project_id)
    if status:
        query = query.where(Sprint.status == status)
    sprints = db.scalars(query.order_by(Sprint.created_at.desc())).all()
    return [_sprint_out(db, s) for s in sprints]


@router.post("/workspaces/{workspace_id}/sprints", response_model=SprintOut, status_code=201)
def create_sprint(
    workspace_id: uuid.UUID,
    body: SprintCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    if body.project_id:
        perms.require_project_view(body.project_id)
    if body.start_date and body.end_date and body.end_date <= body.start_date:
        raise HTTPException(status_code=422, detail="End date must be after start date")
    if body.scrum_master_id:
        _validate_scrum_master(db, workspace_id, body.scrum_master_id)
    sprint = Sprint(
        workspace_id=workspace_id,
        project_id=body.project_id,
        name=body.name,
        goal=body.goal,
        start_date=body.start_date,
        end_date=body.end_date,
        scrum_master_id=body.scrum_master_id,
        created_by=perms.user.id,
    )
    db.add(sprint)
    db.flush()
    log_activity(db, workspace_id=workspace_id, action="sprint.created",
                 actor_id=perms.user.id, project_id=body.project_id,
                 data={"sprint_id": str(sprint.id), "name": sprint.name})
    db.commit()
    return _sprint_out(db, sprint)


@router.get("/sprints/{sprint_id}", response_model=SprintOut)
def get_sprint(
    sprint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    return _sprint_out(db, sprint)


@router.patch("/sprints/{sprint_id}", response_model=SprintOut)
def update_sprint(
    sprint_id: uuid.UUID,
    body: SprintUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_sprint_manager(sprint.workspace_id, sprint.scrum_master_id)
    changes = body.model_dump(exclude_unset=True)
    start = changes.get("start_date", sprint.start_date)
    end = changes.get("end_date", sprint.end_date)
    if start and end and end <= start:
        raise HTTPException(status_code=422, detail="End date must be after start date")
    if changes.get("scrum_master_id"):
        _validate_scrum_master(db, sprint.workspace_id, changes["scrum_master_id"])
    for field, value in changes.items():
        setattr(sprint, field, value)
    db.commit()
    _emit_sprint(sprint)
    return _sprint_out(db, sprint)


@router.delete("/sprints/{sprint_id}", response_model=Message)
def delete_sprint(
    sprint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_admin(sprint.workspace_id)
    sprint.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Message(detail="Sprint deleted")


def _workspace_member_users(db: Session, workspace_id: uuid.UUID) -> list[User]:
    user_ids = db.scalars(
        select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)
    ).all()
    if not user_ids:
        return []
    return db.scalars(select(User).where(User.id.in_(user_ids), User.is_active.is_(True))).all()


@router.post("/sprints/{sprint_id}/start", response_model=SprintOut)
def start_sprint(
    sprint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_sprint_manager(sprint.workspace_id, sprint.scrum_master_id)
    if sprint.status != "planned":
        raise HTTPException(status_code=409, detail=f"Sprint is already {sprint.status}")
    other_active = db.scalar(
        select(Sprint).where(
            Sprint.workspace_id == sprint.workspace_id,
            Sprint.project_id == sprint.project_id,
            Sprint.status == "active",
            Sprint.deleted_at.is_(None),
        )
    )
    if other_active:
        raise HTTPException(status_code=409, detail=f"Sprint '{other_active.name}' is already active")
    sprint.status = "active"
    sprint.started_at = datetime.now(timezone.utc)
    if not sprint.start_date:
        sprint.start_date = date.today()

    url = f"{settings.FRONTEND_URL}/app/sprints?sprint={sprint.id}"
    for user in _workspace_member_users(db, sprint.workspace_id):
        if user.id != perms.user.id:
            notify(
                db, user.id, "sprint_started", f"Sprint '{sprint.name}' has started",
                sprint.goal, data={"sprint_id": str(sprint.id)},
                workspace_id=sprint.workspace_id, project_id=sprint.project_id,
            )
        email_service.send_sprint_started_email(
            user.email, sprint.name, sprint.goal,
            sprint.end_date.isoformat() if sprint.end_date else None, url,
        )
    log_activity(db, workspace_id=sprint.workspace_id, action="sprint.started",
                 actor_id=perms.user.id, project_id=sprint.project_id,
                 data={"sprint_id": str(sprint.id), "name": sprint.name})
    db.commit()
    _emit_sprint(sprint)
    return _sprint_out(db, sprint)


@router.post("/sprints/{sprint_id}/complete", response_model=SprintOut)
def complete_sprint(
    sprint_id: uuid.UUID,
    body: SprintCompleteRequest | None = None,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_sprint_manager(sprint.workspace_id, sprint.scrum_master_id)
    if sprint.status != "active":
        raise HTTPException(status_code=409, detail="Only active sprints can be completed")

    # Optional rollover: move unfinished tasks into another sprint (Jira-style)
    moved = 0
    if body and body.move_incomplete_to:
        target = db.get(Sprint, body.move_incomplete_to)
        if (
            not target
            or target.deleted_at is not None
            or target.id == sprint.id
            or target.workspace_id != sprint.workspace_id
            or target.status == "completed"
        ):
            raise HTTPException(status_code=422, detail="Invalid sprint to move unfinished tasks to")
        incomplete_links = db.scalars(
            select(SprintTask)
            .join(Task, Task.id == SprintTask.task_id)
            .where(
                SprintTask.sprint_id == sprint.id,
                Task.completed_at.is_(None),
                Task.deleted_at.is_(None),
            )
        ).all()
        in_target = set(
            db.scalars(select(SprintTask.task_id).where(SprintTask.sprint_id == target.id)).all()
        )
        for link in incomplete_links:
            task = db.get(Task, link.task_id)
            # Project-scoped target sprints only accept their own project's tasks
            if target.project_id and task.project_id != target.project_id:
                continue
            db.delete(link)
            if link.task_id not in in_target:
                db.add(SprintTask(sprint_id=target.id, task_id=link.task_id, added_by=perms.user.id))
            moved += 1

    sprint.status = "completed"
    sprint.completed_at = datetime.now(timezone.utc)

    _count, total, completed = _sprint_points(db, sprint.id)
    url = f"{settings.FRONTEND_URL}/app/sprints?sprint={sprint.id}"
    for user in _workspace_member_users(db, sprint.workspace_id):
        if user.id != perms.user.id:
            notify(
                db, user.id, "sprint_completed", f"Sprint '{sprint.name}' completed",
                f"{completed}/{total} story points done",
                data={"sprint_id": str(sprint.id)},
                workspace_id=sprint.workspace_id, project_id=sprint.project_id,
            )
        email_service.send_sprint_completed_email(user.email, sprint.name, completed, total, url)
    log_activity(db, workspace_id=sprint.workspace_id, action="sprint.completed",
                 actor_id=perms.user.id, project_id=sprint.project_id,
                 data={"sprint_id": str(sprint.id), "completed_points": completed,
                       "total_points": total, "tasks_moved": moved})
    db.commit()
    if body and body.move_incomplete_to:
        _emit_sprint(db.get(Sprint, body.move_incomplete_to), {"tasks_added": moved})
    _emit_sprint(sprint)
    return _sprint_out(db, sprint)


@router.get("/sprints/{sprint_id}/tasks", response_model=list[TaskOut])
def sprint_tasks(
    sprint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    tasks = db.scalars(
        select(Task)
        .join(SprintTask, SprintTask.task_id == Task.id)
        .where(SprintTask.sprint_id == sprint_id, Task.deleted_at.is_(None))
        .order_by(Task.position)
    ).all()
    # Group per project for correct refs
    outs: list[TaskOut] = []
    by_project: dict[uuid.UUID, list[Task]] = {}
    for t in tasks:
        by_project.setdefault(t.project_id, []).append(t)
    for pid, ts in by_project.items():
        project = perms.get_project_or_404(pid)
        outs.extend(task_service.build_task_outs(db, project, ts))
    return outs


@router.post("/sprints/{sprint_id}/tasks", response_model=Message)
def add_sprint_tasks(
    sprint_id: uuid.UUID,
    body: SprintTaskAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    if sprint.status == "completed":
        raise HTTPException(status_code=409, detail="Cannot modify a completed sprint")
    existing = set(
        db.scalars(select(SprintTask.task_id).where(SprintTask.sprint_id == sprint_id)).all()
    )
    added = 0
    for task_id in set(body.task_ids):
        if task_id in existing:
            continue
        task = db.get(Task, task_id)
        if not task or task.deleted_at is not None:
            continue
        # Project-scoped sprints only accept tasks from their own project
        if sprint.project_id and task.project_id != sprint.project_id:
            continue
        project = perms.get_project_or_404(task.project_id)
        if project.workspace_id != sprint.workspace_id:
            continue
        perms.require_project_edit(task.project_id)
        db.add(SprintTask(sprint_id=sprint_id, task_id=task_id, added_by=perms.user.id))
        added += 1
    db.commit()
    _emit_sprint(sprint, {"tasks_added": added})
    return Message(detail=f"{added} task(s) added to sprint")


@router.delete("/sprints/{sprint_id}/tasks/{task_id}", response_model=Message)
def remove_sprint_task(
    sprint_id: uuid.UUID,
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    if sprint.status == "completed":
        raise HTTPException(status_code=409, detail="Cannot modify a completed sprint")
    link = db.scalar(
        select(SprintTask).where(SprintTask.sprint_id == sprint_id, SprintTask.task_id == task_id)
    )
    if not link:
        raise HTTPException(status_code=404, detail="Task is not in this sprint")
    task = db.get(Task, task_id)
    if task:
        perms.require_project_edit(task.project_id)
    db.delete(link)
    db.commit()
    _emit_sprint(sprint, {"task_removed": str(task_id)})
    return Message(detail="Task removed from sprint")


@router.get("/tasks/{task_id}/sprints", response_model=list[SprintOut])
def task_sprints(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Sprints this task belongs to (for the task detail sprint picker)."""
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_project_view(task.project_id)
    sprints = db.scalars(
        select(Sprint)
        .join(SprintTask, SprintTask.sprint_id == Sprint.id)
        .where(SprintTask.task_id == task_id, Sprint.deleted_at.is_(None))
        .order_by(Sprint.created_at.desc())
    ).all()
    return [_sprint_out(db, s) for s in sprints]


@router.get("/sprints/{sprint_id}/burndown", response_model=SprintBurndownOut)
def sprint_burndown(
    sprint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    _count, total, completed = _sprint_points(db, sprint.id)

    points: list[BurndownPoint] = []
    if sprint.start_date and sprint.end_date and total > 0:
        rows = db.execute(
            select(Task.story_points, Task.completed_at)
            .join(SprintTask, SprintTask.task_id == Task.id)
            .where(SprintTask.sprint_id == sprint_id, Task.deleted_at.is_(None))
        ).all()
        days = (sprint.end_date - sprint.start_date).days
        end = min(date.today(), sprint.end_date)
        day = sprint.start_date
        while day <= end:
            done_by_day = sum(
                r[0] or 0 for r in rows if r[1] is not None and r[1].date() <= day
            )
            elapsed = (day - sprint.start_date).days
            ideal = total - (total * elapsed / days) if days > 0 else 0
            points.append(
                BurndownPoint(day=day, remaining_points=total - done_by_day, ideal_points=round(ideal, 1))
            )
            day += timedelta(days=1)
    return SprintBurndownOut(
        sprint_id=sprint_id, total_points=total, completed_points=completed, points=points
    )


# ---------------- Standups ----------------

@router.get("/sprints/{sprint_id}/standups", response_model=Page[StandupOut])
def list_standups(
    sprint_id: uuid.UUID,
    for_date: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    base = select(StandupUpdate).where(StandupUpdate.sprint_id == sprint_id)
    if for_date:
        base = base.where(StandupUpdate.for_date == for_date)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(StandupUpdate.for_date.desc(), StandupUpdate.created_at)
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    briefs = user_briefs(db, [s.user_id for s in rows])
    items = []
    for s in rows:
        out = StandupOut.model_validate(s)
        out.user = briefs.get(s.user_id)
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.post("/sprints/{sprint_id}/standups", response_model=StandupOut, status_code=201)
def submit_standup(
    sprint_id: uuid.UUID,
    body: StandupCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    existing = db.scalar(
        select(StandupUpdate).where(
            StandupUpdate.sprint_id == sprint_id,
            StandupUpdate.user_id == perms.user.id,
            StandupUpdate.for_date == body.for_date,
        )
    )
    if existing:
        existing.yesterday = body.yesterday
        existing.today = body.today
        existing.blockers = body.blockers
        standup = existing
    else:
        standup = StandupUpdate(
            sprint_id=sprint_id, user_id=perms.user.id, for_date=body.for_date,
            yesterday=body.yesterday, today=body.today, blockers=body.blockers,
        )
        db.add(standup)
        db.flush()
    db.commit()
    _emit_sprint(sprint, {"standup_user_id": str(perms.user.id)})
    out = StandupOut.model_validate(standup)
    out.user = user_briefs(db, [perms.user.id]).get(perms.user.id)
    return out
