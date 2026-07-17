import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.config import settings
from app.core.websocket import emit
from app.db.session import get_db
from app.models.comment import Comment
from app.models.sprint import (
    Sprint,
    SprintRetrospective,
    SprintRetrospectiveItem,
    SprintTask,
    StandupUpdate,
)
from app.models.task import Task
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.core.task_ref import format_task_ref
from app.schemas.comment import CommentOut
from app.schemas.common import Message, Page
from app.schemas.sprint import (
    BurndownPoint,
    RetrospectiveItemCreate,
    RetrospectiveItemOut,
    RetrospectiveItemUpdate,
    RetrospectiveOut,
    RetrospectiveUpdate,
    SprintBurndownOut,
    SprintChangeOut,
    SprintCompleteRequest,
    SprintCompleteResponse,
    SprintCreate,
    SprintOut,
    SprintSummaryOut,
    SprintTaskAdd,
    SprintTaskMove,
    SprintUpdate,
    StandupCreate,
    StandupFollowUpCreate,
    StandupOut,
)
from app.schemas.task import TaskOut
from app.services.mention_service import create_mentions
from app.services import email_service, sprint_service, task_service, webhook_service
from app.services.activity_service import log_activity
from app.services.notification_service import notify
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["sprints"])


def _validate_sprint_dates(
    start_date: date | None,
    end_date: date | None,
    *,
    existing_start: date | None = None,
    existing_end: date | None = None,
) -> None:
    today = date.today()
    if start_date is not None and start_date < today and start_date != existing_start:
        raise HTTPException(status_code=422, detail="Start date cannot be in the past")
    if end_date is not None and end_date < today and end_date != existing_end:
        raise HTTPException(status_code=422, detail="End date cannot be in the past")
    if start_date and end_date and end_date <= start_date:
        raise HTTPException(status_code=422, detail="End date must be after start date")


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
    sm_ids = [i for i in (sprint.scrum_master_id, sprint.delegate_scrum_master_id) if i]
    if sm_ids:
        briefs = user_briefs(db, sm_ids)
        if sprint.scrum_master_id:
            out.scrum_master = briefs.get(sprint.scrum_master_id)
        if sprint.delegate_scrum_master_id:
            out.delegate_scrum_master = briefs.get(sprint.delegate_scrum_master_id)
    return out


def _require_sprint_manager(perms: PermissionService, sprint: Sprint) -> None:
    perms.require_sprint_manager(
        sprint.workspace_id, sprint.scrum_master_id, sprint.delegate_scrum_master_id
    )


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


def _validate_scrum_master_ids(
    db: Session,
    workspace_id: uuid.UUID,
    scrum_master_id: uuid.UUID | None,
    delegate_scrum_master_id: uuid.UUID | None = None,
) -> None:
    """Scrum master and delegate must be workspace members; cannot be the same person."""
    if scrum_master_id and delegate_scrum_master_id and scrum_master_id == delegate_scrum_master_id:
        raise HTTPException(status_code=422, detail="Scrum master and delegate must be different people")
    for user_id in (scrum_master_id, delegate_scrum_master_id):
        if user_id:
            _validate_scrum_master(db, workspace_id, user_id)


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
    _validate_sprint_dates(body.start_date, body.end_date)
    if body.scrum_master_id or body.delegate_scrum_master_id:
        _validate_scrum_master_ids(
            db, workspace_id, body.scrum_master_id, body.delegate_scrum_master_id
        )
    sprint = Sprint(
        workspace_id=workspace_id,
        project_id=body.project_id,
        name=body.name,
        goal=body.goal,
        start_date=body.start_date,
        end_date=body.end_date,
        scrum_master_id=body.scrum_master_id,
        delegate_scrum_master_id=body.delegate_scrum_master_id,
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
    _require_sprint_manager(perms, sprint)
    changes = body.model_dump(exclude_unset=True)
    start = changes.get("start_date", sprint.start_date)
    end = changes.get("end_date", sprint.end_date)
    _validate_sprint_dates(
        start,
        end,
        existing_start=sprint.start_date,
        existing_end=sprint.end_date,
    )
    next_sm = changes.get("scrum_master_id", sprint.scrum_master_id)
    next_delegate = changes.get("delegate_scrum_master_id", sprint.delegate_scrum_master_id)
    if "scrum_master_id" in changes or "delegate_scrum_master_id" in changes:
        _validate_scrum_master_ids(db, sprint.workspace_id, next_sm, next_delegate)
    prev_scope_locked = sprint.scope_locked
    for field, value in changes.items():
        setattr(sprint, field, value)
    if "scope_locked" in changes and sprint.scope_locked != prev_scope_locked:
        log_activity(
            db,
            workspace_id=sprint.workspace_id,
            action="sprint.scope_lock_changed",
            actor_id=perms.user.id,
            project_id=sprint.project_id,
            data={"sprint_id": str(sprint.id), "scope_locked": sprint.scope_locked},
        )
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
    _require_sprint_manager(perms, sprint)
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
    webhook_service.enqueue_workspace_event(
        db, sprint.workspace_id, "sprint.started",
        {
            "sprint_id": str(sprint.id),
            "workspace_id": str(sprint.workspace_id),
            "project_id": str(sprint.project_id) if sprint.project_id else None,
            "name": sprint.name,
            "goal": sprint.goal,
            "end_date": sprint.end_date.isoformat() if sprint.end_date else None,
        },
    )
    return _sprint_out(db, sprint)


@router.post("/sprints/{sprint_id}/complete", response_model=SprintCompleteResponse)
def complete_sprint(
    sprint_id: uuid.UUID,
    body: SprintCompleteRequest | None = None,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    _require_sprint_manager(perms, sprint)
    if sprint.status != "active":
        raise HTTPException(status_code=409, detail="Only active sprints can be completed")

    summary = sprint_service.build_sprint_summary(db, sprint)

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
    sprint_service.get_or_create_retrospective(db, sprint)

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
    webhook_service.enqueue_workspace_event(
        db, sprint.workspace_id, "sprint.completed",
        {
            "sprint_id": str(sprint.id),
            "workspace_id": str(sprint.workspace_id),
            "project_id": str(sprint.project_id) if sprint.project_id else None,
            "name": sprint.name,
            "completed_points": completed,
            "total_points": total,
            "tasks_moved": moved,
        },
    )
    return SprintCompleteResponse(sprint=_sprint_out(db, sprint), summary=summary)


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
        .where(SprintTask.sprint_id == sprint_id, Task.deleted_at.is_(None), perms.visible_task_filter())
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
    perms.require_sprint_scope_edit(sprint)
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
        db.flush()
        from app.services import goal_task_link_service

        goal_task_link_service.sync_task_to_linked_sprint_targets(
            db, perms, sprint_id, task_id
        )
        log_activity(
            db,
            workspace_id=sprint.workspace_id,
            action="sprint.task_added",
            actor_id=perms.user.id,
            project_id=task.project_id,
            task_id=task.id,
            data={
                "sprint_id": str(sprint_id),
                "task_id": str(task.id),
                "task_ref": format_task_ref(project.id, task.number),
            },
        )
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
    perms.require_sprint_scope_edit(sprint)
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
        project = perms.get_project_or_404(task.project_id)
        log_activity(
            db,
            workspace_id=sprint.workspace_id,
            action="sprint.task_removed",
            actor_id=perms.user.id,
            project_id=task.project_id,
            task_id=task.id,
            data={
                "sprint_id": str(sprint_id),
                "task_id": str(task.id),
                "task_ref": format_task_ref(project.id, task.number),
            },
        )
    db.delete(link)
    db.commit()
    _emit_sprint(sprint, {"task_removed": str(task_id)})
    return Message(detail="Task removed from sprint")


@router.post("/sprints/{sprint_id}/tasks/{task_id}/move", response_model=Message)
def move_sprint_task(
    sprint_id: uuid.UUID,
    task_id: uuid.UUID,
    body: SprintTaskMove,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Move a task from this sprint to another (scrum master / delegate)."""
    source = db.get(Sprint, sprint_id)
    if not source or source.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_sprint_scope_edit(source)
    if source.status == "completed":
        raise HTTPException(status_code=409, detail="Cannot move tasks from a completed sprint")

    target = db.get(Sprint, body.target_sprint_id)
    if (
        not target
        or target.deleted_at is not None
        or target.id == source.id
        or target.workspace_id != source.workspace_id
        or target.status == "completed"
    ):
        raise HTTPException(status_code=422, detail="Invalid target sprint")

    link = db.scalar(
        select(SprintTask).where(SprintTask.sprint_id == sprint_id, SprintTask.task_id == task_id)
    )
    if not link:
        raise HTTPException(status_code=404, detail="Task is not in this sprint")

    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    if source.project_id and task.project_id != source.project_id:
        raise HTTPException(status_code=400, detail="Task does not belong to this sprint's project")
    if target.project_id and task.project_id != target.project_id:
        raise HTTPException(status_code=400, detail="Target sprint only accepts tasks from its project")

    already_in_target = db.scalar(
        select(SprintTask.id).where(
            SprintTask.sprint_id == target.id, SprintTask.task_id == task_id
        )
    )
    if already_in_target:
        raise HTTPException(status_code=409, detail="Task is already in the target sprint")

    db.delete(link)
    db.add(SprintTask(sprint_id=target.id, task_id=task_id, added_by=perms.user.id))
    log_activity(
        db,
        workspace_id=source.workspace_id,
        action="sprint.task_moved",
        actor_id=perms.user.id,
        project_id=task.project_id,
        data={
            "task_id": str(task_id),
            "task_ref": format_task_ref(task.project_id, task.number),
            "from_sprint_id": str(source.id),
            "from_sprint_name": source.name,
            "to_sprint_id": str(target.id),
            "to_sprint_name": target.name,
        },
    )
    db.commit()
    _emit_sprint(source, {"task_removed": str(task_id)})
    _emit_sprint(target, {"tasks_added": 1})
    return Message(detail=f"Task moved to {target.name}")


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
        span_days = max((sprint.end_date - sprint.start_date).days, 1)
        today = date.today()
        last_remaining = total
        day = sprint.start_date
        while day <= sprint.end_date:
            if day <= today:
                done_by_day = sum(
                    r[0] or 0 for r in rows if r[1] is not None and r[1].date() <= day
                )
                last_remaining = total - done_by_day
            elapsed = (day - sprint.start_date).days
            ideal = total - (total * elapsed / span_days)
            points.append(
                BurndownPoint(
                    day=day,
                    remaining_points=last_remaining,
                    ideal_points=round(max(ideal, 0), 1),
                )
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
    briefs = user_briefs(db, [s.user_id for s in rows] + [s.blocker_resolved_by for s in rows if s.blocker_resolved_by])
    items = []
    for s in rows:
        out = StandupOut.model_validate(s)
        out.user = briefs.get(s.user_id)
        if s.blocker_resolved_by:
            out.blocker_resolver = briefs.get(s.blocker_resolved_by)
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
        if (body.blockers or "").strip() != (existing.blockers or "").strip():
            existing.blocker_resolved_at = None
            existing.blocker_resolved_by = None
        existing.blockers = body.blockers
        standup = existing
        db.flush()
    else:
        standup = StandupUpdate(
            sprint_id=sprint_id, user_id=perms.user.id, for_date=body.for_date,
            yesterday=body.yesterday, today=body.today, blockers=body.blockers,
        )
        db.add(standup)
        db.flush()
        standup = standup
    db.commit()
    _emit_sprint(sprint, {"standup_user_id": str(perms.user.id)})
    out = StandupOut.model_validate(standup)
    out.user = user_briefs(db, [perms.user.id]).get(perms.user.id)
    return out


@router.post(
    "/sprints/{sprint_id}/standups/{standup_id}/follow-up",
    response_model=CommentOut,
    status_code=201,
)
def follow_up_standup_blocker(
    sprint_id: uuid.UUID,
    standup_id: uuid.UUID,
    body: StandupFollowUpCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_can_follow_up_standup_blocker(sprint)

    standup = db.get(StandupUpdate, standup_id)
    if not standup or standup.sprint_id != sprint_id:
        raise HTTPException(status_code=404, detail="Standup not found")
    if not (standup.blockers or "").strip():
        raise HTTPException(status_code=400, detail="This standup has no blocker to follow up on")

    in_sprint = db.scalar(
        select(SprintTask.id).where(
            SprintTask.sprint_id == sprint_id,
            SprintTask.task_id == body.task_id,
        )
    )
    if not in_sprint:
        raise HTTPException(status_code=400, detail="Task is not part of this sprint")

    task = db.get(Task, body.task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_task_view(task)
    project = perms.get_project_or_404(task.project_id)

    comment = Comment(task_id=task.id, author_id=perms.user.id, body=body.body)
    db.add(comment)
    db.flush()

    ref = format_task_ref(project.id, task.number)
    url = task_service.task_url(task.id)
    author_name = (
        perms.user.profile.full_name
        if perms.user.profile and perms.user.profile.full_name
        else perms.user.email
    )
    from app.api.v1.comments import _commentable_user_ids

    allowed = _commentable_user_ids(db, project.id, project.workspace_id)
    create_mentions(
        db,
        body=body.body,
        author=perms.user,
        allowed_user_ids=allowed,
        comment_id=comment.id,
        context_label=f"a standup follow-up on {ref}",
        url=url,
        workspace_id=project.workspace_id,
        project_id=project.id,
    )
    db.commit()
    db.refresh(comment)
    out = CommentOut.model_validate(comment)
    out.author = user_briefs(db, [perms.user.id]).get(perms.user.id)
    return out


@router.post(
    "/sprints/{sprint_id}/standups/{standup_id}/resolve-blocker",
    response_model=StandupOut,
)
def resolve_standup_blocker(
    sprint_id: uuid.UUID,
    standup_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_can_follow_up_standup_blocker(sprint)

    standup = db.get(StandupUpdate, standup_id)
    if not standup or standup.sprint_id != sprint_id:
        raise HTTPException(status_code=404, detail="Standup not found")
    if not (standup.blockers or "").strip():
        raise HTTPException(status_code=400, detail="This standup has no blocker")
    if standup.blocker_resolved_at:
        raise HTTPException(status_code=409, detail="Blocker is already resolved")

    standup.blocker_resolved_at = datetime.now(timezone.utc)
    standup.blocker_resolved_by = perms.user.id
    log_activity(
        db,
        workspace_id=sprint.workspace_id,
        action="standup.blocker_resolved",
        actor_id=perms.user.id,
        project_id=sprint.project_id,
        data={
            "sprint_id": str(sprint_id),
            "standup_id": str(standup_id),
            "user_id": str(standup.user_id),
        },
    )
    db.commit()
    db.refresh(standup)
    briefs = user_briefs(db, [standup.user_id, perms.user.id])
    out = StandupOut.model_validate(standup)
    out.user = briefs.get(standup.user_id)
    out.blocker_resolver = briefs.get(perms.user.id)
    return out


@router.get("/sprints/{sprint_id}/changes", response_model=list[SprintChangeOut])
def list_sprint_changes(
    sprint_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    return sprint_service.list_sprint_changes(db, sprint_id, limit=limit)


@router.get("/sprints/{sprint_id}/summary", response_model=SprintSummaryOut)
def get_sprint_summary(
    sprint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    perms.require_workspace_member(sprint.workspace_id)
    return sprint_service.build_sprint_summary(db, sprint)


# ---------------- Retrospectives ----------------

def _require_completed_sprint(sprint: Sprint) -> None:
    if sprint.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Retrospective is only available after the sprint is completed",
        )


def _get_sprint_or_404(db: Session, sprint_id: uuid.UUID) -> Sprint:
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return sprint


def _require_workspace_user(db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> None:
    member = db.scalar(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=422, detail="Assignee must be a workspace member")


@router.get("/sprints/{sprint_id}/retrospective", response_model=RetrospectiveOut)
def get_retrospective(
    sprint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = _get_sprint_or_404(db, sprint_id)
    perms.require_workspace_member(sprint.workspace_id)
    _require_completed_sprint(sprint)
    out = sprint_service.build_retrospective_out(db, sprint)
    db.commit()  # persist auto-create if needed
    return out


@router.patch("/sprints/{sprint_id}/retrospective", response_model=RetrospectiveOut)
def update_retrospective(
    sprint_id: uuid.UUID,
    body: RetrospectiveUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = _get_sprint_or_404(db, sprint_id)
    perms.require_workspace_member(sprint.workspace_id)
    _require_completed_sprint(sprint)
    retro = sprint_service.get_or_create_retrospective(db, sprint)
    if body.stage_notes is not None:
        retro.stage_notes = body.stage_notes
    db.commit()
    return sprint_service.build_retrospective_out(db, sprint)


@router.post(
    "/sprints/{sprint_id}/retrospective/items",
    response_model=RetrospectiveItemOut,
    status_code=201,
)
def create_retrospective_item(
    sprint_id: uuid.UUID,
    body: RetrospectiveItemCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = _get_sprint_or_404(db, sprint_id)
    perms.require_workspace_member(sprint.workspace_id)
    _require_completed_sprint(sprint)
    if body.category != "bud" and body.assignee_id is not None:
        raise HTTPException(status_code=422, detail="Assignees are only supported on action items")
    if body.assignee_id is not None:
        _require_workspace_user(db, sprint.workspace_id, body.assignee_id)

    retro = sprint_service.get_or_create_retrospective(db, sprint)
    item = SprintRetrospectiveItem(
        retrospective_id=retro.id,
        category=body.category,
        body=body.body.strip(),
        author_id=perms.user.id,
        assignee_id=body.assignee_id if body.category == "bud" else None,
        is_done=False,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    briefs = user_briefs(db, [item.author_id] + ([item.assignee_id] if item.assignee_id else []))
    return sprint_service._item_out(item, briefs)


@router.patch(
    "/sprints/{sprint_id}/retrospective/items/{item_id}",
    response_model=RetrospectiveItemOut,
)
def update_retrospective_item(
    sprint_id: uuid.UUID,
    item_id: uuid.UUID,
    body: RetrospectiveItemUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = _get_sprint_or_404(db, sprint_id)
    perms.require_workspace_member(sprint.workspace_id)
    _require_completed_sprint(sprint)
    retro = sprint_service.get_or_create_retrospective(db, sprint)
    item = db.get(SprintRetrospectiveItem, item_id)
    if not item or item.retrospective_id != retro.id:
        raise HTTPException(status_code=404, detail="Retrospective item not found")
    perms.require_can_manage_sprint_retrospective_item(sprint, item.author_id)

    if body.body is not None:
        item.body = body.body.strip()
    if body.is_done is not None:
        if item.category != "bud":
            raise HTTPException(status_code=422, detail="Only action items can be marked done")
        item.is_done = body.is_done
    if "assignee_id" in body.model_fields_set:
        if item.category != "bud":
            raise HTTPException(status_code=422, detail="Assignees are only supported on action items")
        if body.assignee_id is not None:
            _require_workspace_user(db, sprint.workspace_id, body.assignee_id)
        item.assignee_id = body.assignee_id

    db.commit()
    db.refresh(item)
    briefs = user_briefs(db, [item.author_id] + ([item.assignee_id] if item.assignee_id else []))
    return sprint_service._item_out(item, briefs)


@router.delete(
    "/sprints/{sprint_id}/retrospective/items/{item_id}",
    response_model=Message,
)
def delete_retrospective_item(
    sprint_id: uuid.UUID,
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    sprint = _get_sprint_or_404(db, sprint_id)
    perms.require_workspace_member(sprint.workspace_id)
    _require_completed_sprint(sprint)
    retro = sprint_service.get_or_create_retrospective(db, sprint)
    item = db.get(SprintRetrospectiveItem, item_id)
    if not item or item.retrospective_id != retro.id:
        raise HTTPException(status_code=404, detail="Retrospective item not found")
    perms.require_can_manage_sprint_retrospective_item(sprint, item.author_id)
    db.delete(item)
    db.commit()
    return Message(detail="Retrospective item deleted")
