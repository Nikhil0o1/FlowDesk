import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.db.session import get_db
from app.models.project import Project
from app.models.sprint import SprintTask
from app.models.task import (
    CustomStatus,
    RecurringTask,
    Task,
    TaskAssignee,
    TaskAttachment,
    TaskDependency,
)
from app.models.time_entry import TimeEntry
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.task import (
    AssigneesAdd,
    AttachmentOut,
    DependencyAdd,
    RecurringTaskCreate,
    RecurringTaskOut,
    TaskCreate,
    TaskDependencyOut,
    TaskDetailOut,
    TaskOut,
    TaskUpdate,
)
from app.services import task_service
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["tasks"])

SORTABLE = {
    "created_at": Task.created_at,
    "updated_at": Task.updated_at,
    "due_date": Task.due_date,
    "priority": Task.priority,
    "title": Task.title,
    "position": Task.position,
    "number": Task.number,
}


def _apply_filters(
    query,
    *,
    status_id: uuid.UUID | None = None,
    priority: str | None = None,
    assignee_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
    task_type: str | None = None,
    label: str | None = None,
    list_id: uuid.UUID | None = None,
    sprint_id: uuid.UUID | None = None,
    due: str | None = None,
    q: str | None = None,
):
    if status_id:
        query = query.where(Task.status_id == status_id)
    if priority:
        query = query.where(Task.priority == priority)
    if assignee_id:
        query = query.where(
            Task.id.in_(select(TaskAssignee.task_id).where(TaskAssignee.user_id == assignee_id))
        )
    if created_by:
        query = query.where(Task.created_by == created_by)
    if task_type:
        query = query.where(Task.task_type == task_type)
    if label:
        query = query.where(Task.labels.contains([label]))
    if list_id:
        query = query.where(Task.list_id == list_id)
    if sprint_id:
        query = query.where(
            Task.id.in_(select(SprintTask.task_id).where(SprintTask.sprint_id == sprint_id))
        )
    today = date.today()
    if due == "today":
        query = query.where(Task.due_date == today, Task.completed_at.is_(None))
    elif due == "week":
        query = query.where(
            Task.due_date >= today,
            Task.due_date <= today + timedelta(days=7),
            Task.completed_at.is_(None),
        )
    elif due == "overdue":
        query = query.where(Task.due_date < today, Task.completed_at.is_(None))
    if q:
        like = f"%{q}%"
        query = query.where(or_(Task.title.ilike(like), Task.description.ilike(like)))
    return query


@router.get("/projects/{project_id}/tasks", response_model=Page[TaskOut])
def list_tasks(
    project_id: uuid.UUID,
    status_id: uuid.UUID | None = None,
    priority: str | None = Query(default=None, pattern="^(urgent|high|normal|low)$"),
    assignee_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
    task_type: str | None = Query(default=None, pattern="^(task|bug|story|epic)$"),
    label: str | None = None,
    list_id: uuid.UUID | None = None,
    sprint_id: uuid.UUID | None = None,
    due: str | None = Query(default=None, pattern="^(today|week|overdue)$"),
    q: str | None = Query(default=None, max_length=200),
    include_subtasks: bool = False,
    include_archived: bool = False,
    sort_by: str = Query(default="position"),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_view(project_id)
    query = select(Task).where(Task.project_id == project_id, Task.deleted_at.is_(None))
    if not include_subtasks:
        query = query.where(Task.parent_task_id.is_(None))
    if not include_archived:
        query = query.where(Task.is_archived.is_(False))
    query = _apply_filters(
        query, status_id=status_id, priority=priority, assignee_id=assignee_id,
        created_by=created_by, task_type=task_type, label=label, list_id=list_id,
        sprint_id=sprint_id, due=due, q=q,
    )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    sort_col = SORTABLE.get(sort_by, Task.position)
    query = query.order_by(asc(sort_col) if sort_dir == "asc" else desc(sort_col), Task.created_at)
    tasks = db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
    return Page(
        items=task_service.build_task_outs(db, project, tasks),
        total=total, page=page, page_size=page_size,
    )


@router.get("/me/tasks", response_model=Page[TaskOut])
def my_tasks(
    relation: str = Query(default="assigned", pattern="^(assigned|created)$"),
    due: str | None = Query(default=None, pattern="^(today|week|overdue)$"),
    priority: str | None = Query(default=None, pattern="^(urgent|high|normal|low)$"),
    task_type: str | None = Query(default=None, pattern="^(task|bug|story|epic)$"),
    include_completed: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    perms: PermissionService = Depends(get_permissions),
):
    accessible = perms.accessible_project_ids()
    if not accessible:
        return Page(items=[], total=0, page=page, page_size=page_size)
    query = select(Task).where(
        Task.project_id.in_(accessible),
        Task.deleted_at.is_(None),
        Task.is_archived.is_(False),
    )
    if relation == "assigned":
        query = query.where(
            Task.id.in_(select(TaskAssignee.task_id).where(TaskAssignee.user_id == user.id))
        )
    else:
        query = query.where(Task.created_by == user.id)
    if not include_completed:
        query = query.where(Task.completed_at.is_(None))
    query = _apply_filters(query, priority=priority, task_type=task_type, due=due)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    tasks = db.scalars(
        query.order_by(Task.due_date.asc().nullslast(), Task.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()

    # Group by project for correct refs
    outs: list[TaskOut] = []
    by_project: dict[uuid.UUID, list[Task]] = {}
    for t in tasks:
        by_project.setdefault(t.project_id, []).append(t)
    order = {t.id: i for i, t in enumerate(tasks)}
    for pid, ts in by_project.items():
        project = db.get(Project, pid)
        outs.extend(task_service.build_task_outs(db, project, ts))
    outs.sort(key=lambda o: order.get(o.id, 0))
    return Page(items=outs, total=total, page=page, page_size=page_size)


@router.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=201)
def create_task(
    project_id: uuid.UUID,
    body: TaskCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_edit(project_id)
    if body.parent_task_id:
        parent = db.get(Task, body.parent_task_id)
        if not parent or parent.project_id != project_id or parent.deleted_at is not None:
            raise HTTPException(status_code=400, detail="Parent task not found in this project")
        if parent.parent_task_id is not None:
            raise HTTPException(status_code=400, detail="Subtasks cannot be nested further")
    status_id = body.status_id or task_service.default_status_id(db, project_id)
    if body.status_id:
        status = db.get(CustomStatus, body.status_id)
        if not status or status.project_id != project_id:
            raise HTTPException(status_code=400, detail="Status does not belong to this project")
    max_pos = db.scalar(
        select(func.coalesce(func.max(Task.position), 0)).where(Task.project_id == project_id)
    )
    task = Task(
        project_id=project_id,
        list_id=body.list_id,
        parent_task_id=body.parent_task_id,
        number=task_service.claim_task_number(db, project_id),
        title=body.title,
        description=body.description,
        priority=body.priority,
        status_id=status_id,
        task_type=body.task_type,
        start_date=body.start_date,
        due_date=body.due_date,
        story_points=body.story_points,
        labels=body.labels,
        position=(max_pos or 0) + 1024,
        created_by=perms.user.id,
    )
    db.add(task)
    db.flush()
    if body.assignee_ids:
        task_service.assign_users(db, task, project, body.assignee_ids, perms.user)
    task_service.log_task_activity(db, project, task, "task.created", perms.user.id)
    task_service.emit_task_event("task.created", db, project, task)
    db.commit()
    return task_service.build_task_outs(db, project, [task])[0]


@router.get("/tasks/{task_id}", response_model=TaskDetailOut)
def get_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_view(task.project_id)

    base = task_service.build_task_outs(db, project, [task])[0]
    detail = TaskDetailOut(**base.model_dump())

    subtasks = db.scalars(
        select(Task).where(Task.parent_task_id == task_id, Task.deleted_at.is_(None))
        .order_by(Task.position, Task.created_at)
    ).all()
    detail.subtasks = task_service.build_task_outs(db, project, subtasks)

    deps = db.scalars(select(TaskDependency).where(TaskDependency.task_id == task_id)).all()
    dep_tasks = {
        t.id: t for t in db.scalars(
            select(Task).where(Task.id.in_([d.depends_on_task_id for d in deps]))
        ).all()
    } if deps else {}
    detail.dependencies = [
        TaskDependencyOut(
            id=d.id, task_id=d.task_id, depends_on_task_id=d.depends_on_task_id,
            depends_on=(
                task_service.build_task_outs(db, project, [dep_tasks[d.depends_on_task_id]])[0]
                if d.depends_on_task_id in dep_tasks else None
            ),
        )
        for d in deps
    ]
    dependents = db.scalars(
        select(TaskDependency).where(TaskDependency.depends_on_task_id == task_id)
    ).all()
    dependent_tasks = {
        t.id: t for t in db.scalars(
            select(Task).where(Task.id.in_([d.task_id for d in dependents]))
        ).all()
    } if dependents else {}
    detail.dependents = [
        TaskDependencyOut(
            id=d.id, task_id=d.task_id, depends_on_task_id=d.depends_on_task_id,
            depends_on=(
                task_service.build_task_outs(db, project, [dependent_tasks[d.task_id]])[0]
                if d.task_id in dependent_tasks else None
            ),
        )
        for d in dependents
    ]

    attachments = db.scalars(
        select(TaskAttachment).where(
            TaskAttachment.task_id == task_id, TaskAttachment.deleted_at.is_(None)
        ).order_by(TaskAttachment.created_at)
    ).all()
    briefs = user_briefs(db, [a.uploaded_by for a in attachments if a.uploaded_by])
    detail.attachments = []
    for a in attachments:
        out = AttachmentOut.model_validate(a)
        out.uploader = briefs.get(a.uploaded_by) if a.uploaded_by else None
        detail.attachments.append(out)

    detail.total_tracked_seconds = db.scalar(
        select(func.coalesce(func.sum(TimeEntry.duration_seconds), 0)).where(
            TimeEntry.task_id == task_id, TimeEntry.duration_seconds.is_not(None)
        )
    ) or 0
    return detail


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_edit(task.project_id)

    changes = body.model_dump(exclude_unset=True)
    changed_fields: list[str] = []
    status_changed = False

    if "status_id" in changes and changes["status_id"] is not None:
        status = db.get(CustomStatus, changes["status_id"])
        if not status or status.project_id != task.project_id:
            raise HTTPException(status_code=400, detail="Status does not belong to this project")
        status_changed = task_service.apply_status_change(db, task, changes["status_id"])
        if status_changed:
            changed_fields.append("status_id")
        changes.pop("status_id")

    if changes.pop("clear_priority", False):
        task.priority = None
        changed_fields.append("priority")
        changes.pop("priority", None)
    if changes.pop("clear_due_date", False):
        task.due_date = None
        changed_fields.append("due_date")
        changes.pop("due_date", None)

    for field, value in changes.items():
        if value is not None and getattr(task, field) != value:
            setattr(task, field, value)
            changed_fields.append(field)

    if changed_fields:
        task_service.log_task_activity(
            db, project, task,
            "task.status_changed" if status_changed and changed_fields == ["status_id"] else "task.updated",
            perms.user.id, {"fields": changed_fields},
        )
        task_service.emit_task_event(
            "task.updated", db, project, task,
            {"fields": changed_fields, "status_id": str(task.status_id) if task.status_id else None},
        )
        db.commit()
    return task_service.build_task_outs(db, project, [task])[0]


@router.delete("/tasks/{task_id}", response_model=Message)
def delete_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_edit(task.project_id)
    task.deleted_at = datetime.now(timezone.utc)
    task_service.log_task_activity(db, project, task, "task.deleted", perms.user.id)
    task_service.emit_task_event("task.deleted", db, project, task)
    db.commit()
    return Message(detail="Task deleted")


@router.post("/tasks/{task_id}/assignees", response_model=Message)
def add_assignees(
    task_id: uuid.UUID,
    body: AssigneesAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_edit(task.project_id)
    added = task_service.assign_users(db, task, project, body.user_ids, perms.user)
    if added:
        task_service.log_task_activity(
            db, project, task, "task.assigned", perms.user.id,
            {"user_ids": [str(u) for u in added]},
        )
    db.commit()
    return Message(detail=f"{len(added)} assignee(s) added")


@router.delete("/tasks/{task_id}/assignees/{user_id}", response_model=Message)
def remove_assignee(
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_edit(task.project_id)
    assignee = db.scalar(
        select(TaskAssignee).where(TaskAssignee.task_id == task_id, TaskAssignee.user_id == user_id)
    )
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignee not found")
    db.delete(assignee)
    task_service.log_task_activity(
        db, project, task, "task.unassigned", perms.user.id, {"user_id": str(user_id)}
    )
    task_service.emit_task_event("task.updated", db, project, task, {"fields": ["assignees"]})
    db.commit()
    return Message(detail="Assignee removed")


@router.post("/tasks/{task_id}/dependencies", response_model=Message, status_code=201)
def add_dependency(
    task_id: uuid.UUID,
    body: DependencyAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_edit(task.project_id)
    if body.depends_on_task_id == task_id:
        raise HTTPException(status_code=400, detail="A task cannot depend on itself")
    other = db.get(Task, body.depends_on_task_id)
    if not other or other.project_id != task.project_id or other.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Dependency task not found in this project")
    existing = db.scalar(
        select(TaskDependency).where(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_task_id == body.depends_on_task_id,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Dependency already exists")
    reverse = db.scalar(
        select(TaskDependency).where(
            TaskDependency.task_id == body.depends_on_task_id,
            TaskDependency.depends_on_task_id == task_id,
        )
    )
    if reverse:
        raise HTTPException(status_code=400, detail="This would create a circular dependency")
    db.add(TaskDependency(task_id=task_id, depends_on_task_id=body.depends_on_task_id, created_by=perms.user.id))
    task_service.log_task_activity(
        db, project, task, "task.dependency_added", perms.user.id,
        {"depends_on": str(body.depends_on_task_id)},
    )
    task_service.emit_task_event("task.updated", db, project, task, {"fields": ["dependencies"]})
    db.commit()
    return Message(detail="Dependency added")


@router.delete("/tasks/{task_id}/dependencies/{dependency_id}", response_model=Message)
def remove_dependency(
    task_id: uuid.UUID,
    dependency_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_edit(task.project_id)
    dep = db.get(TaskDependency, dependency_id)
    if not dep or dep.task_id != task_id:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(dep)
    task_service.emit_task_event("task.updated", db, project, task, {"fields": ["dependencies"]})
    db.commit()
    return Message(detail="Dependency removed")


# ---------------- Recurring tasks ----------------

@router.get("/projects/{project_id}/recurring-tasks", response_model=list[RecurringTaskOut])
def list_recurring(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    rows = db.scalars(
        select(RecurringTask).where(
            RecurringTask.project_id == project_id, RecurringTask.is_active.is_(True)
        )
    ).all()
    return [RecurringTaskOut.model_validate(r) for r in rows]


@router.post("/projects/{project_id}/recurring-tasks", response_model=RecurringTaskOut, status_code=201)
def create_recurring(
    project_id: uuid.UUID,
    body: RecurringTaskCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_edit(project_id)
    if not body.template.get("title"):
        raise HTTPException(status_code=422, detail="Template must include a title")
    rec = RecurringTask(
        project_id=project_id,
        list_id=body.list_id,
        source_task_id=body.source_task_id,
        frequency=body.frequency,
        interval=body.interval,
        template=body.template,
        next_occurrence_at=body.next_occurrence_at,
        created_by=perms.user.id,
    )
    db.add(rec)
    db.commit()
    return RecurringTaskOut.model_validate(rec)


@router.delete("/recurring-tasks/{recurring_id}", response_model=Message)
def delete_recurring(
    recurring_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    rec = db.get(RecurringTask, recurring_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring task not found")
    perms.require_project_edit(rec.project_id)
    rec.is_active = False
    db.commit()
    return Message(detail="Recurring task disabled")
