import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.websocket import emit
from app.models.comment import Comment
from app.models.project import Project
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
        out.ref = f"{project.key}-{task.number}"
        out.status = statuses.get(task.status_id)
        out.assignees = assignees_by_task.get(task.id, [])
        counts = subtask_counts.get(task.id, (0, 0))
        out.subtask_count, out.subtask_done_count = counts
        out.comment_count = comment_counts.get(task.id, 0)
        outs.append(out)
    return outs


def task_rooms(project: Project) -> list[str]:
    return [f"project:{project.id}", f"workspace:{project.workspace_id}"]


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
    existing = set(
        db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)).all()
    )
    added: list[uuid.UUID] = []
    actor_name = actor.profile.full_name if actor.profile and actor.profile.full_name else actor.email
    ref = f"{project.key}-{task.number}"
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
            email_service.send_task_assigned_email(
                user.email, task.title, ref, actor_name, task_url(task.id)
            )
    if added:
        db.flush()
        emit(
            "task.assigned",
            task_rooms(project),
            payload={"task_id": str(task.id), "user_ids": [str(u) for u in added],
                     "assigned_by": str(actor.id)},
            project_id=project.id,
            workspace_id=project.workspace_id,
            task_id=task.id,
        )
    return added


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
    return True


def emit_task_event(event: str, db: Session, project: Project, task: Task, payload: dict | None = None) -> None:
    emit(
        event,
        task_rooms(project),
        payload={"task_id": str(task.id), "title": task.title, **(payload or {})},
        project_id=project.id,
        workspace_id=project.workspace_id,
        task_id=task.id,
    )


def log_task_activity(db: Session, project: Project, task: Task, action: str, actor_id: uuid.UUID, data: dict | None = None) -> None:
    log_activity(
        db,
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        actor_id=actor_id,
        action=action,
        data={"ref": f"{project.key}-{task.number}", "title": task.title, **(data or {})},
    )
