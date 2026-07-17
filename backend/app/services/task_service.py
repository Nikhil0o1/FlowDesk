import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.task_ref import format_task_ref
from app.core.websocket import emit
from app.models.comment import Comment
from app.models.project import Project, ProjectMember, TaskList
from app.models.task import CustomStatus, Task, TaskAssignee
from app.models.user import User
from app.schemas.task import TaskOut
from app.schemas.project import CustomStatusOut
from app.services import email_service
from app.services.activity_service import log_activity
from app.services.notification_service import notify
from app.services.user_service import user_briefs


def _now() -> datetime:
    return datetime.now(timezone.utc)


def task_url(task_id: uuid.UUID) -> str:
    return f"{settings.FRONTEND_URL}/app/tasks/{task_id}"


def claim_task_number(db: Session, project_id: uuid.UUID) -> int:
    """Atomically claim the next per-project task number (row lock)."""
    project = db.execute(
        select(Project).where(Project.id == project_id).with_for_update()
    ).scalar_one()
    number = project.next_task_number
    project.next_task_number = number + 1
    return number


def default_status_id(db: Session, project_id: uuid.UUID) -> uuid.UUID | None:
    status = db.scalar(
        select(CustomStatus)
        .where(CustomStatus.project_id == project_id)
        .order_by(CustomStatus.position)
        .limit(1)
    )
    return status.id if status else None


def build_task_outs(db: Session, project: Project, tasks: list[Task]) -> list[TaskOut]:
    """Batch-build TaskOut objects without N+1 queries."""
    if not tasks:
        return []
    task_ids = [t.id for t in tasks]

    assignee_rows = db.scalars(
        select(TaskAssignee).where(TaskAssignee.task_id.in_(task_ids))
    ).all()
    briefs = user_briefs(db, [a.user_id for a in assignee_rows])
    assignees_by_task: dict[uuid.UUID, list] = {}
    for a in assignee_rows:
        if a.user_id in briefs:
            assignees_by_task.setdefault(a.task_id, []).append(briefs[a.user_id])

    statuses = {
        s.id: CustomStatusOut.model_validate(s)
        for s in db.scalars(
            select(CustomStatus).where(CustomStatus.project_id == project.id)
        ).all()
    }

    subtask_rows = db.execute(
        select(Task.parent_task_id, func.count(Task.id), func.count(Task.completed_at))
        .where(Task.parent_task_id.in_(task_ids), Task.deleted_at.is_(None))
        .group_by(Task.parent_task_id)
    ).all()
    subtask_counts = {row[0]: (row[1], row[2]) for row in subtask_rows}

    comment_rows = db.execute(
        select(Comment.task_id, func.count(Comment.id))
        .where(Comment.task_id.in_(task_ids), Comment.deleted_at.is_(None))
        .group_by(Comment.task_id)
    ).all()
    comment_counts = dict(comment_rows)

    outs = []
    for task in tasks:
        out = TaskOut.model_validate(task)
        out.ref = format_task_ref(project.id, task.number)
        out.status = statuses.get(task.status_id)
        out.assignees = assignees_by_task.get(task.id, [])
        counts = subtask_counts.get(task.id, (0, 0))
        out.subtask_count, out.subtask_done_count = counts
        out.comment_count = comment_counts.get(task.id, 0)
        outs.append(out)
    return outs


def task_rooms(project: Project) -> list[str]:
    return [f"project:{project.id}", f"workspace:{project.workspace_id}"]


def validate_task_list(db: Session, project_id: uuid.UUID, list_id: uuid.UUID | None) -> None:
    if list_id is None:
        return
    task_list = db.get(TaskList, list_id)
    if not task_list or task_list.project_id != project_id:
        raise HTTPException(status_code=400, detail="Task list does not belong to this project")


def validate_assignee_ids(db: Session, project_id: uuid.UUID, user_ids: list[uuid.UUID]) -> None:
    if not user_ids:
        return
    allowed = set(
        db.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
        ).all()
    )
    invalid = [uid for uid in user_ids if uid not in allowed]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail="One or more assignees are not members of this project",
        )


def validate_task_schedule_dates(
    *,
    start_date: date | None = None,
    due_date: date | None = None,
    existing_start: date | None = None,
    existing_due: date | None = None,
    today: date | None = None,
) -> None:
    """Ensure due date is on or after start date. Past dates are allowed."""
    _ = (existing_start, existing_due, today)
    if start_date and due_date and due_date < start_date:
        raise HTTPException(status_code=422, detail="Due date must be on or after the start date")


def assign_users(
    db: Session,
    task: Task,
    project: Project,
    user_ids: list[uuid.UUID],
    actor: User,
    *,
    notify_users: bool = True,
) -> list[uuid.UUID]:
    """Add assignees. Notifies + emails newly assigned users (never creates users)."""
    validate_assignee_ids(db, project.id, user_ids)
    existing = set(
        db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)).all()
    )
    added: list[uuid.UUID] = []
    actor_name = actor.profile.full_name if actor.profile and actor.profile.full_name else actor.email
    ref = format_task_ref(project.id, task.number)
    for user_id in user_ids:
        if user_id in existing:
            continue
        user = db.get(User, user_id)
        if not user or not user.is_active or user.deleted_at is not None:
            continue
        db.add(TaskAssignee(task_id=task.id, user_id=user_id, assigned_by=actor.id))
        added.append(user_id)
        if notify_users and user_id != actor.id:
            notify(
                db, user_id, "task_assigned",
                f"{actor_name} assigned you {ref}",
                task.title,
                data={"task_id": str(task.id), "project_id": str(project.id)},
                workspace_id=project.workspace_id,
                project_id=project.id,
            )
            from app.services.inbox_service import user_email_notifications_enabled

            if user_email_notifications_enabled(db, user_id):
                email_service.send_task_assigned_email(
                    user.email, task.title, ref, actor_name, task_url(task.id)
                )
    if added:
        db.flush()
    return added


def emit_assigned(db: Session, project: Project, task: Task, added: list[uuid.UUID], actor: User) -> None:
    """Broadcast task.assigned — call only after the transaction has committed."""
    emit(
        "task.assigned",
        task_rooms(project),
        payload={"task_id": str(task.id), "user_ids": [str(u) for u in added],
                 "assigned_by": str(actor.id)},
        project_id=project.id,
        workspace_id=project.workspace_id,
        task_id=task.id,
    )
    _dispatch_task_webhook(
        db, project, task, "task.assigned",
        {"assignee_ids": [str(u) for u in added], "assigned_by": str(actor.id)},
    )


def apply_status_change(db: Session, task: Task, new_status_id: uuid.UUID | None) -> bool:
    """Set status and maintain completed_at from the status category."""
    if new_status_id == task.status_id:
        return False
    task.status_id = new_status_id
    status = db.get(CustomStatus, new_status_id) if new_status_id else None
    if status and status.category == "done":
        task.completed_at = _now()
    else:
        task.completed_at = None
    from app.services import goal_progress_service

    goal_progress_service.on_task_changed(db, task.id)
    return True


STATUS_ADVANCE_RANK: dict[str, int] = {
    "todo": 0,
    "in_progress": 1,
    "done": 2,
    "cancelled": 3,
}


def status_advance_rank(status: CustomStatus | None) -> tuple[int, int]:
    """Lower tuple = earlier / less-advanced in the workflow."""
    if not status:
        return (99, 99)
    return (STATUS_ADVANCE_RANK.get(status.category, 9), status.position)


def incomplete_subtask_count(db: Session, task_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(Task)
            .where(
                Task.parent_task_id == task_id,
                Task.deleted_at.is_(None),
                Task.completed_at.is_(None),
            )
        )
        or 0
    )


def assert_parent_may_complete(
    db: Session,
    task: Task,
    new_status_id: uuid.UUID,
    *,
    force_complete_subtasks: bool = False,
) -> None:
    """Block completing a parent while subtasks are open unless explicitly confirmed."""
    status = db.get(CustomStatus, new_status_id)
    if not status or status.category != "done":
        return
    pending = incomplete_subtask_count(db, task.id)
    if pending > 0 and not force_complete_subtasks:
        raise HTTPException(
            status_code=422,
            detail="Subtasks are pending. Confirm to complete the parent task anyway.",
        )


def rollup_parent_task_status(db: Session, parent_task_id: uuid.UUID) -> bool:
    """Set parent status to the least-advanced status among its subtasks."""
    parent = db.get(Task, parent_task_id)
    if not parent or parent.deleted_at is not None:
        return False
    children = db.scalars(
        select(Task).where(
            Task.parent_task_id == parent.id,
            Task.deleted_at.is_(None),
        )
    ).all()
    if not children:
        return False
    statuses: list[CustomStatus] = []
    for child in children:
        if child.status_id:
            st = db.get(CustomStatus, child.status_id)
            if st:
                statuses.append(st)
    if not statuses:
        return False
    lowest = min(statuses, key=status_advance_rank)
    if parent.status_id == lowest.id:
        return False
    return apply_status_change(db, parent, lowest.id)


def emit_task_event(event: str, db: Session, project: Project, task: Task, payload: dict | None = None) -> None:
    emit(
        event,
        task_rooms(project),
        payload={"task_id": str(task.id), "title": task.title, **(payload or {})},
        project_id=project.id,
        workspace_id=project.workspace_id,
        task_id=task.id,
    )
    if event in ("task.created", "task.updated", "task.deleted"):
        extra = dict(payload or {})
        _dispatch_task_webhook(db, project, task, event, extra)
        # A status_id change also fires the dedicated status.changed event.
        if event == "task.updated" and "status_id" in (extra.get("fields") or []):
            _dispatch_task_webhook(db, project, task, "status.changed", extra)


def _dispatch_task_webhook(
    db: Session, project: Project, task: Task, event: str, extra: dict
) -> None:
    """Enqueue an outbound webhook for a task event. Best-effort, post-commit."""
    from app.services import webhook_service

    # Private tasks never leave FlowDesk — org-level webhook consumers must not
    # see tasks that are hidden from most org members.
    if getattr(task, "is_private", False):
        return
    status = db.get(CustomStatus, task.status_id) if task.status_id else None
    webhook_service.enqueue_workspace_event(
        db,
        project.workspace_id,
        event,
        {
            "task_id": str(task.id),
            "task_ref": format_task_ref(project.id, task.number),
            "project_id": str(project.id),
            "workspace_id": str(project.workspace_id),
            "title": task.title,
            "priority": task.priority,
            "status": status.name if status else None,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            **extra,
        },
    )


def log_task_activity(db: Session, project: Project, task: Task, action: str, actor_id: uuid.UUID, data: dict | None = None) -> None:
    log_activity(
        db,
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        actor_id=actor_id,
        action=action,
        data={"ref": format_task_ref(project.id, task.number), "title": task.title, **(data or {})},
    )
