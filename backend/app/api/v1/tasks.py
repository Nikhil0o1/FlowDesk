import secrets
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import String, asc, cast, desc, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.core.config import settings
from app.core.pat_route_registry import pat_allow
from app.core.task_ref import format_task_ref
from app.core.rate_limit import limiter, public_task_rate_key
from app.db.session import get_db
from app.models.custom_field import CustomFieldDefinition, CustomFieldValue
from app.models.organization import OrganizationMember
from app.models.project import Project
from app.models.sprint import SprintTask
from app.models.task import (
    CustomStatus,
    RecurringTask,
    Task,
    TaskAssignee,
    TaskAttachment,
    TaskChecklist,
    TaskChecklistItem,
    TaskDependency,
    TaskShareMember,
)
from app.models.time_entry import TimeEntry
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.project import ProjectOut
from app.schemas.task import (
    AssigneesAdd,
    AttachmentOut,
    ChecklistCreate,
    ChecklistItemCreate,
    ChecklistItemOut,
    ChecklistItemUpdate,
    ChecklistOut,
    ChecklistUpdate,
    CustomFieldDefCreate,
    CustomFieldDefOut,
    CustomFieldDefUpdate,
    CustomFieldValueOut,
    CustomFieldValueSet,
    DependencyAdd,
    MyTasksSummaryOut,
    RecurringTaskCreate,
    RecurringTaskOut,
    ShareMemberAdd,
    ShareMemberRoleUpdate,
    TaskCreate,
    TaskDependencyOut,
    TaskDetailOut,
    TaskOut,
    TaskShareMemberOut,
    TaskShareState,
    TaskShareUpdate,
    TaskUpdate,
)
from app.services import github_service, task_service
from app.services.personal_list_service import get_or_create_personal_project
from app.services.public_access_service import public_assignee_display, resolve_public_task
from app.services import github_api_service
from app.services.token_vault import reveal
from app.services.calendar_sync_service import push_task, refresh_task, remove_task
from app.services.github_issue_title import format_github_issue_title
from app.services.github_issue_body import format_github_issue_body
from app.services.permission_service import PermissionError403, PermissionService
from app.services.task_follow_service import maybe_auto_follow
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


def _require_can_change_task_status(db: Session, perms: PermissionService, project: Project, task: Task) -> None:
    """Normal members can move only their assigned tasks; managers can move any task."""
    ws = perms.get_workspace_or_404(project.workspace_id)
    if perms.org_role(ws.organization_id) == "owner":
        return
    if perms._is_org_admin_or_owner(ws.organization_id):
        return
    if perms.workspace_role(project.workspace_id) in ("admin", "owner"):
        return
    if perms.project_role(project.id) == "admin":
        return
    if perms.is_scrum_master_of_active_sprint_for_task(task.id):
        return

    assignee_ids = set(
        db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)).all()
    )
    if assignee_ids and perms.user.id not in assignee_ids:
        raise HTTPException(status_code=403, detail="You can only change status for tasks assigned to you")


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
    due_from: date | None = None,
    due_to: date | None = None,
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
    if due_from:
        query = query.where(Task.due_date >= due_from, Task.completed_at.is_(None))
    if due_to:
        query = query.where(Task.due_date <= due_to, Task.completed_at.is_(None))
    if q:
        stripped = q.strip()
        like = f"%{stripped}%"
        ref_sql = func.concat(
            func.upper(func.left(func.replace(cast(Task.project_id, String), "-", ""), 8)),
            "-",
            cast(Task.number, String),
        )
        query = query.where(
            or_(
                Task.title.ilike(like),
                Task.description.ilike(like),
                ref_sql.ilike(f"%{stripped.upper()}%"),
            )
        )
    return query


def _my_work_project_ids(
    db: Session,
    perms: PermissionService,
    workspace_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Accessible non-personal projects, optionally scoped to one workspace."""
    accessible = perms.accessible_project_ids()
    if not accessible:
        return []
    query = select(Project.id).where(
        Project.id.in_(accessible),
        Project.deleted_at.is_(None),
        Project.is_personal.is_(False),
    )
    if workspace_id is not None:
        query = query.where(Project.workspace_id == workspace_id)
    return list(db.scalars(query).all())


def _my_work_base_query(
    db: Session,
    perms: PermissionService,
    user: User,
    relation: str,
    workspace_id: uuid.UUID | None = None,
):
    project_ids = _my_work_project_ids(db, perms, workspace_id)
    if not project_ids:
        return None, None
    top_level_only, work_scope = _my_work_scope(relation, user.id)
    query = select(Task).where(
        Task.project_id.in_(project_ids),
        Task.deleted_at.is_(None),
        Task.is_archived.is_(False),
        perms.visible_task_filter(),
        top_level_only,
        work_scope,
    )
    return query, project_ids


def _my_work_scope(relation: str, user_id: uuid.UUID):
    """Parent tasks for My Work — subtasks are shown nested under their parent."""
    if relation == "assigned":
        matching = select(TaskAssignee.task_id).where(TaskAssignee.user_id == user_id)
    elif relation == "delegated":
        assigned_to_me = select(TaskAssignee.task_id).where(TaskAssignee.user_id == user_id)
        has_assignees = select(TaskAssignee.task_id).distinct()
        matching = select(Task.id).where(
            Task.created_by == user_id,
            Task.id.in_(has_assignees),
            ~Task.id.in_(assigned_to_me),
        )
    else:
        matching = select(Task.id).where(Task.created_by == user_id)
    parents_of_matching_subtasks = (
        select(Task.parent_task_id)
        .where(Task.id.in_(matching), Task.parent_task_id.isnot(None))
        .distinct()
    )
    return Task.parent_task_id.is_(None), or_(
        Task.id.in_(matching),
        Task.id.in_(parents_of_matching_subtasks),
    )


@router.get("/projects/{project_id}/tasks", response_model=Page[TaskOut])
@pat_allow(
    "tasks:read",
    rate_category="standard",
    authz_class="project",
    tenant_resolution="Project membership + task visibility",
)
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
    query = select(Task).where(
        Task.project_id == project_id, Task.deleted_at.is_(None), perms.visible_task_filter()
    )
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


@router.get("/me/personal-list", response_model=ProjectOut)
def get_personal_list(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    project = get_or_create_personal_project(
        db, workspace_id=workspace_id, user_id=perms.user.id
    )
    out = ProjectOut.model_validate(project)
    out.my_role = "admin"
    out.my_explicit_role = "admin"
    return out


@router.get("/me/tasks/summary", response_model=MyTasksSummaryOut)
def my_tasks_summary(
    workspace_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    perms: PermissionService = Depends(get_permissions),
):
    if workspace_id is not None:
        perms.require_workspace_member(workspace_id)
    base, _ = _my_work_base_query(db, perms, user, "assigned", workspace_id)
    if base is None:
        return MyTasksSummaryOut(today=0, overdue=0, today_and_overdue=0, next=0, unscheduled=0)

    today = date.today()
    week_end = today + timedelta(days=7)
    incomplete = base.where(Task.completed_at.is_(None))

    today_count = db.scalar(
        select(func.count()).select_from(
            incomplete.where(Task.due_date == today).subquery()
        )
    ) or 0
    overdue_count = db.scalar(
        select(func.count()).select_from(
            incomplete.where(Task.due_date < today).subquery()
        )
    ) or 0
    today_and_overdue = db.scalar(
        select(func.count()).select_from(
            incomplete.where(Task.due_date.is_not(None), Task.due_date <= today).subquery()
        )
    ) or 0
    next_count = db.scalar(
        select(func.count()).select_from(
            incomplete.where(
                Task.due_date > today,
                Task.due_date <= week_end,
            ).subquery()
        )
    ) or 0
    unscheduled_count = db.scalar(
        select(func.count()).select_from(
            incomplete.where(Task.due_date.is_(None)).subquery()
        )
    ) or 0
    return MyTasksSummaryOut(
        today=today_count,
        overdue=overdue_count,
        today_and_overdue=today_and_overdue,
        next=next_count,
        unscheduled=unscheduled_count,
    )


@router.get("/me/tasks", response_model=Page[TaskOut])
@pat_allow(
    "tasks:read",
    rate_category="standard",
    authz_class="principal",
    tenant_resolution="Tasks visible to user across memberships (no workspace restriction)",
)
def my_tasks(
    relation: str = Query(default="assigned", pattern="^(assigned|created|delegated)$"),
    workspace_id: uuid.UUID | None = None,
    due: str | None = Query(default=None, pattern="^(today|week|overdue)$"),
    due_from: date | None = None,
    due_to: date | None = None,
    priority: str | None = Query(default=None, pattern="^(urgent|high|normal|low)$"),
    task_type: str | None = Query(default=None, pattern="^(task|bug|story|epic)$"),
    include_completed: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    perms: PermissionService = Depends(get_permissions),
):
    if workspace_id is not None:
        perms.require_workspace_member(workspace_id)
    base, project_ids = _my_work_base_query(db, perms, user, relation, workspace_id)
    if base is None:
        return Page(items=[], total=0, page=page, page_size=page_size)
    query = base
    if not include_completed:
        query = query.where(Task.completed_at.is_(None))
    query = _apply_filters(
        query, priority=priority, task_type=task_type, due=due, due_from=due_from, due_to=due_to,
    )
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
@pat_allow(
    "tasks:write",
    rate_category="standard_write",
    authz_class="project",
    tenant_resolution="Project membership + task create permission",
)
def create_task(
    project_id: uuid.UUID,
    body: TaskCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_edit(project_id)
    parent: Task | None = None
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
    task_service.validate_task_list(db, project_id, body.list_id)
    if body.assignee_ids:
        task_service.validate_assignee_ids(db, project_id, body.assignee_ids)
    task_service.validate_task_schedule_dates(
        start_date=body.start_date,
        due_date=body.due_date,
    )
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
        planned_start_at=body.planned_start_at,
        planned_end_at=body.planned_end_at,
        story_points=body.story_points,
        labels=body.labels,
        time_estimate_seconds=body.time_estimate_seconds,
        position=(max_pos or 0) + 1024,
        created_by=perms.user.id,
    )
    db.add(task)
    db.flush()
    assigned: list[uuid.UUID] = []
    if body.assignee_ids:
        assigned = task_service.assign_users(db, task, project, body.assignee_ids, perms.user)
    if body.sync_to_google:
        push_task(db, perms.user, project, task)
    sync_github = body.create_github_issue or bool(parent and parent.github_issue_number)
    if sync_github:
        github_service.ensure_task_github_issue(db, task, project)
    task_service.log_task_activity(db, project, task, "task.created", perms.user.id)
    maybe_auto_follow(db, perms.user.id, task.id)
    db.commit()
    task_service.emit_task_event("task.created", db, project, task)
    if assigned:
        task_service.emit_assigned(db, project, task, assigned, perms.user)
    return task_service.build_task_outs(db, project, [task])[0]


@router.get("/tasks/{task_id}", response_model=TaskDetailOut)
@pat_allow(
    "tasks:read",
    rate_category="standard",
    authz_class="object",
    tenant_resolution="Task → project → org; object-level RBAC",
)
def get_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_task_view(task)
    project = perms.get_project_or_404(task.project_id)

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

    detail.checklists = _task_checklists(db, task_id)
    detail.custom_fields = [
        CustomFieldValueOut(field_id=v.field_id, value=v.value or {})
        for v in db.scalars(select(CustomFieldValue).where(CustomFieldValue.task_id == task_id)).all()
    ]
    return detail


def _task_checklists(db: Session, task_id: uuid.UUID) -> list[ChecklistOut]:
    checklists = db.scalars(
        select(TaskChecklist).where(TaskChecklist.task_id == task_id)
        .order_by(TaskChecklist.position, TaskChecklist.created_at)
    ).all()
    if not checklists:
        return []
    items = db.scalars(
        select(TaskChecklistItem)
        .where(TaskChecklistItem.checklist_id.in_([c.id for c in checklists]))
        .order_by(TaskChecklistItem.position, TaskChecklistItem.created_at)
    ).all()
    by_list: dict[uuid.UUID, list] = {}
    for it in items:
        by_list.setdefault(it.checklist_id, []).append(it)
    out: list[ChecklistOut] = []
    for c in checklists:
        cl = ChecklistOut.model_validate(c)
        cl.items = [ChecklistItemOut.model_validate(i) for i in by_list.get(c.id, [])]
        out.append(cl)
    return out


@router.patch("/tasks/{task_id}", response_model=TaskOut)
@pat_allow(
    "tasks:write",
    rate_category="standard_write",
    authz_class="object",
    tenant_resolution="Task → project → org; object-level RBAC",
)
def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")

    changes = body.model_dump(exclude_unset=True)
    force_complete_subtasks = bool(changes.pop("force_complete_subtasks", False))
    story_points_only = set(changes.keys()) == {"story_points"}
    try:
        perms.require_task_edit(task)
    except PermissionError403:
        if not story_points_only:
            raise
        perms.require_can_set_sprint_task_story_points(task)

    project = perms.get_project_or_404(task.project_id)
    changed_fields: list[str] = []
    status_changed = False
    original_start = task.start_date
    original_due = task.due_date
    start_touched = False
    due_touched = False

    if "status_id" in changes and changes["status_id"] is not None:
        status = db.get(CustomStatus, changes["status_id"])
        if not status or status.project_id != task.project_id:
            raise HTTPException(status_code=400, detail="Status does not belong to this project")
        _require_can_change_task_status(db, perms, project, task)
        task_service.assert_parent_may_complete(
            db,
            task,
            changes["status_id"],
            force_complete_subtasks=force_complete_subtasks,
        )
        status_changed = task_service.apply_status_change(db, task, changes["status_id"])
        if status_changed:
            changed_fields.append("status_id")
            # Mirror the new board status onto the linked GitHub issue (open/close + label)
            _sync_github_issue(db, task, status, background_tasks)
        changes.pop("status_id")
        if status_changed and task.parent_task_id:
            parent_rolled = task_service.rollup_parent_task_status(db, task.parent_task_id)
            if parent_rolled:
                parent = db.get(Task, task.parent_task_id)
                if parent:
                    task_service.log_task_activity(
                        db,
                        project,
                        parent,
                        "task.status_changed",
                        perms.user.id,
                        {"fields": ["status_id"], "rolled_up_from_subtask": str(task.id)},
                    )

    if changes.pop("clear_priority", False):
        task.priority = None
        changed_fields.append("priority")
        changes.pop("priority", None)
    if changes.pop("clear_start_date", False):
        task.start_date = None
        changed_fields.append("start_date")
        changes.pop("start_date", None)
        start_touched = True
    if changes.pop("clear_due_date", False):
        task.due_date = None
        changed_fields.append("due_date")
        changes.pop("due_date", None)
        due_touched = True
    if changes.pop("clear_planned_times", False):
        task.planned_start_at = None
        task.planned_end_at = None
        changed_fields.extend(["planned_start_at", "planned_end_at"])
    if changes.pop("clear_time_estimate", False):
        task.time_estimate_seconds = None
        changed_fields.append("time_estimate_seconds")
        changes.pop("time_estimate_seconds", None)
    if changes.pop("clear_parent", False):
        task.parent_task_id = None
        changed_fields.append("parent_task_id")
        changes.pop("parent_task_id", None)
    if "list_id" in changes:
        task_service.validate_task_list(db, task.project_id, changes["list_id"])
    parent_id = changes.pop("parent_task_id", None)
    if parent_id is not None:
        parent = db.get(Task, parent_id)
        if not parent or parent.project_id != task.project_id or parent.deleted_at is not None:
            raise HTTPException(status_code=400, detail="Parent task not found in this project")
        if parent.id == task.id or parent.parent_task_id is not None:
            raise HTTPException(status_code=400, detail="Cannot nest under this task")
        task.parent_task_id = parent_id
        changed_fields.append("parent_task_id")

    if "start_date" in changes:
        start_touched = True
    if "due_date" in changes:
        due_touched = True

    if start_touched or due_touched:
        next_start = changes["start_date"] if "start_date" in changes else task.start_date
        next_due = changes["due_date"] if "due_date" in changes else task.due_date
        task_service.validate_task_schedule_dates(
            start_date=next_start,
            due_date=next_due,
            existing_start=original_start,
            existing_due=original_due,
        )

    calendar_fields = {"title", "due_date", "planned_start_at", "planned_end_at"}
    calendar_dirty = False

    for field, value in changes.items():
        if value is not None and getattr(task, field) != value:
            setattr(task, field, value)
            changed_fields.append(field)
            if field in calendar_fields:
                calendar_dirty = True

    if changed_fields:
        if task.github_issue_number and (
            "title" in changed_fields or "description" in changed_fields
        ):
            _sync_github_issue(
                db,
                task,
                None,
                background_tasks,
                title=format_github_issue_title(project.name, task.title)
                if "title" in changed_fields
                else None,
                body=format_github_issue_body(
                    task_ref=format_task_ref(project.id, task.number),
                    title=task.title,
                    description=task.description,
                    task_id=task.id,
                )
                if "description" in changed_fields
                else None,
            )
        task_service.log_task_activity(
            db, project, task,
            "task.status_changed" if status_changed and changed_fields == ["status_id"] else "task.updated",
            perms.user.id, {"fields": changed_fields},
        )
        maybe_auto_follow(db, perms.user.id, task.id)
        if calendar_dirty and task.google_calendar_event_id:
            refresh_task(db, perms.user, project, task)
        if status_changed:
            from app.services import goal_progress_service

            updated_goals = goal_progress_service.goals_for_task(db, task.id)
        else:
            updated_goals = []
        db.commit()
        task_service.emit_task_event(
            "task.updated", db, project, task,
            {"fields": changed_fields, "status_id": str(task.status_id) if task.status_id else None},
        )
        if updated_goals:
            goal_progress_service.emit_goals_updated(updated_goals)
    return task_service.build_task_outs(db, project, [task])[0]


@router.delete("/tasks/{task_id}", response_model=Message)
@pat_allow(
    "tasks:write",
    rate_category="standard_write",
    authz_class="object",
    tenant_resolution="Task → project → org; object-level RBAC",
)
def delete_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_task_edit(task)
    project = perms.get_project_or_404(task.project_id)
    remove_task(db, perms.user, task)
    task.deleted_at = datetime.now(timezone.utc)
    from app.services import goal_progress_service

    goal_progress_service.on_task_changed(db, task.id)
    updated_goals = goal_progress_service.goals_for_task(db, task.id)
    task_service.log_task_activity(db, project, task, "task.deleted", perms.user.id)
    db.commit()
    task_service.emit_task_event("task.deleted", db, project, task)
    if updated_goals:
        goal_progress_service.emit_goals_updated(updated_goals)
    return Message(detail="Task deleted")


@router.post("/tasks/{task_id}/duplicate", response_model=TaskOut, status_code=201)
def duplicate_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    src = db.get(Task, task_id)
    if not src or src.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_task_edit(src)
    project = perms.get_project_or_404(src.project_id)
    max_pos = db.scalar(
        select(func.coalesce(func.max(Task.position), 0)).where(Task.project_id == src.project_id)
    ) or 0
    copy = Task(
        project_id=src.project_id,
        list_id=src.list_id,
        parent_task_id=src.parent_task_id,
        number=task_service.claim_task_number(db, src.project_id),
        title=f"{src.title} (copy)",
        description=src.description,
        priority=src.priority,
        status_id=src.status_id,
        task_type=src.task_type,
        start_date=src.start_date,
        due_date=src.due_date,
        story_points=src.story_points,
        labels=list(src.labels or []),
        time_estimate_seconds=src.time_estimate_seconds,
        position=(max_pos or 0) + 1024,
        created_by=perms.user.id,
    )
    db.add(copy)
    db.flush()
    assignee_ids = db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == src.id)).all()
    if assignee_ids:
        task_service.assign_users(db, copy, project, list(assignee_ids), perms.user)
    task_service.log_task_activity(db, project, copy, "task.created", perms.user.id)
    maybe_auto_follow(db, perms.user.id, copy.id)
    db.commit()
    task_service.emit_task_event("task.created", db, project, copy)
    return task_service.build_task_outs(db, project, [copy])[0]


@router.post("/tasks/{task_id}/assignees", response_model=Message)
@pat_allow(
    "tasks:write",
    rate_category="standard_write",
    authz_class="object",
    tenant_resolution="Task object auth for assignee management",
)
def add_assignees(
    task_id: uuid.UUID,
    body: AssigneesAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_can_manage_task_assignees(task)
    project = perms.get_project_or_404(task.project_id)
    added = task_service.assign_users(db, task, project, body.user_ids, perms.user)
    if added:
        task_service.log_task_activity(
            db, project, task, "task.assigned", perms.user.id,
            {"user_ids": [str(u) for u in added]},
        )
    db.commit()
    if added:
        task_service.emit_assigned(db, project, task, added, perms.user)
    return Message(detail=f"{len(added)} assignee(s) added")


@router.delete("/tasks/{task_id}/assignees/{user_id}", response_model=Message)
@pat_allow(
    "tasks:write",
    rate_category="standard_write",
    authz_class="object",
    tenant_resolution="Task object auth for assignee management",
)
def remove_assignee(
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_can_manage_task_assignees(task)
    project = perms.get_project_or_404(task.project_id)
    assignee = db.scalar(
        select(TaskAssignee).where(TaskAssignee.task_id == task_id, TaskAssignee.user_id == user_id)
    )
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignee not found")
    db.delete(assignee)
    task_service.log_task_activity(
        db, project, task, "task.unassigned", perms.user.id, {"user_id": str(user_id)}
    )
    db.commit()
    task_service.emit_task_event("task.updated", db, project, task, {"fields": ["assignees"]})
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
    perms.require_task_edit(task)
    project = perms.get_project_or_404(task.project_id)
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
    db.commit()
    task_service.emit_task_event("task.updated", db, project, task, {"fields": ["dependencies"]})
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
    perms.require_task_edit(task)
    project = perms.get_project_or_404(task.project_id)
    dep = db.get(TaskDependency, dependency_id)
    if not dep or dep.task_id != task_id:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(dep)
    db.commit()
    task_service.emit_task_event("task.updated", db, project, task, {"fields": ["dependencies"]})
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
    task_service.validate_task_list(db, project_id, body.list_id)
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


# ---------------------------------------------------------------------------
# GitHub issue state sync
# ---------------------------------------------------------------------------

def _sync_github_issue(
    db: Session,
    task: Task,
    new_status: CustomStatus | None,
    background_tasks: BackgroundTasks,
    *,
    title: str | None = None,
    body: str | None = None,
) -> None:
    """Mirror task changes onto its linked GitHub issue (best-effort, background)."""
    if not task.github_issue_number:
        return
    from app.models.github import GithubConnection, GithubRepository
    from sqlalchemy import select as sa_select

    repo = db.scalar(
        sa_select(GithubRepository).where(
            GithubRepository.project_id == task.project_id,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    )
    if not repo or not repo.connection_id:
        return
    conn = db.get(GithubConnection, repo.connection_id)
    if not conn:
        return

    try:
        owner, repo_name = github_api_service.parse_repo_full_name(repo.repo_full_name)
    except github_api_service.GitHubPathValidationError:
        return
    token = reveal(conn.access_token) or ""
    if not token:
        return

    state = "closed" if (new_status and new_status.category == "done") else "open"
    label_name = f"{github_api_service.FLOWDESK_LABEL_PREFIX}{new_status.name}" if new_status else None
    label_color = (new_status.color or "").lstrip("#") if new_status else None
    if new_status is not None:
        background_tasks.add_task(
            github_api_service.sync_issue_status,
            token, owner, repo_name, task.github_issue_number,
            state=state, label_name=label_name, label_color=label_color,
        )
    if title is not None or body is not None:
        background_tasks.add_task(
            github_api_service.patch_issue,
            token, owner, repo_name, task.github_issue_number,
            title=title,
            body=body,
        )


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _live_task(db: Session, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------

def _share_state(db: Session, task: Task) -> TaskShareState:
    members = db.scalars(select(TaskShareMember).where(TaskShareMember.task_id == task.id)).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    return TaskShareState(
        is_private=task.is_private,
        public_enabled=task.public_enabled,
        public_token=task.public_token if task.public_enabled else None,
        public_url=(
            f"{settings.FRONTEND_URL}/t/{task.public_token}"
            if task.public_enabled and task.public_token else None
        ),
        public_expires_at=task.public_expires_at,
        public_searchable=task.public_searchable,
        members=[
            TaskShareMemberOut(user_id=m.user_id, role=m.role, user=briefs.get(m.user_id))
            for m in members
        ],
    )


@router.get("/tasks/{task_id}/share", response_model=TaskShareState)
def get_task_share(task_id: uuid.UUID, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    task = _live_task(db, task_id)
    perms.require_task_view(task)
    return _share_state(db, task)


@router.patch("/tasks/{task_id}/share", response_model=TaskShareState)
def update_task_share(task_id: uuid.UUID, body: TaskShareUpdate, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    task = _live_task(db, task_id)
    perms.require_task_admin(task)
    if body.is_private is not None:
        task.is_private = body.is_private
    if body.public_enabled is not None:
        task.public_enabled = body.public_enabled
        if body.public_enabled and not task.public_token:
            task.public_token = secrets.token_urlsafe(24)
    if body.clear_public_expiry:
        task.public_expires_at = None
    elif body.public_expires_at is not None:
        task.public_expires_at = body.public_expires_at
    if body.public_searchable is not None:
        task.public_searchable = body.public_searchable
    db.commit()
    return _share_state(db, task)


@router.post("/tasks/{task_id}/share/members", response_model=TaskShareState, status_code=201)
def add_task_share_member(task_id: uuid.UUID, body: ShareMemberAdd, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    task = _live_task(db, task_id)
    perms.require_task_admin(task)
    project = perms.get_project_or_404(task.project_id)
    ws = perms.get_workspace_or_404(project.workspace_id)

    user_id = body.user_id
    if not user_id and body.email:
        email = body.email.strip().lower()
        existing = db.scalar(select(User).where(func.lower(User.email) == email))
        in_org = existing and db.scalar(
            select(OrganizationMember.id).where(
                OrganizationMember.organization_id == ws.organization_id,
                OrganizationMember.user_id == existing.id,
            ).limit(1)
        )
        if in_org:
            user_id = existing.id
        else:
            # Not an org member yet — invite them to the project so they gain access
            from app.services import invite_service
            invite_service.create_invite(
                db, inviter=perms.user, email=body.email.strip(), scope="project",
                role="member", organization_id=ws.organization_id,
                workspace_id=project.workspace_id, project_id=project.id,
            )
            db.commit()
            return _share_state(db, task)
    if not user_id:
        raise HTTPException(status_code=422, detail="Provide a user_id or email")

    already = db.scalar(
        select(TaskShareMember).where(
            TaskShareMember.task_id == task.id, TaskShareMember.user_id == user_id
        )
    )
    if not already and user_id != perms.user.id:
        if not task.is_private:
            task.is_private = True
        db.add(TaskShareMember(task_id=task.id, user_id=user_id, role=body.role, created_by=perms.user.id))
        # Tell the person they were given access — in-app + email.
        from app.services import email_service
        from app.services.notification_service import notify

        sharer = (
            perms.user.profile.full_name
            if perms.user.profile and perms.user.profile.full_name else perms.user.email
        )
        ref = format_task_ref(project.id, task.number)
        url = f"{settings.FRONTEND_URL}/app/tasks/{task.id}"
        notify(
            db, user_id, "task_shared",
            f"{sharer} shared a task with you",
            f"{ref} — {task.title}",
            data={"task_id": str(task.id), "url": url},
            workspace_id=project.workspace_id, project_id=project.id,
        )
        target = db.get(User, user_id)
        if target and target.email:
            email_service.send_task_shared_email(target.email, task.title, ref, sharer, url)
    db.commit()
    return _share_state(db, task)


@router.patch("/tasks/{task_id}/share/members/{user_id}", response_model=TaskShareState)
def update_task_share_member(
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    body: ShareMemberRoleUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = _live_task(db, task_id)
    perms.require_task_admin(task)
    member = db.scalar(
        select(TaskShareMember).where(
            TaskShareMember.task_id == task.id, TaskShareMember.user_id == user_id
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Share member not found")
    member.role = body.role
    db.commit()
    return _share_state(db, task)


@router.delete("/tasks/{task_id}/share/members/{user_id}", response_model=TaskShareState)
def remove_task_share_member(task_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    task = _live_task(db, task_id)
    perms.require_task_admin(task)
    member = db.scalar(
        select(TaskShareMember).where(
            TaskShareMember.task_id == task.id, TaskShareMember.user_id == user_id
        )
    )
    if member:
        db.delete(member)
    db.commit()
    return _share_state(db, task)


@router.get("/public/tasks/{token}", include_in_schema=False)
@limiter.limit("60/minute")
@limiter.limit("30/minute", key_func=public_task_rate_key)
def public_task(request: Request, token: str, db: Session = Depends(get_db)):
    """Unauthenticated read-only view of a task shared via public link."""
    task, project = resolve_public_task(db, token)
    status = db.get(CustomStatus, task.status_id) if task.status_id else None
    assignee_ids = db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)).all()
    briefs = user_briefs(db, list(assignee_ids))
    checklists = _task_checklists(db, task.id)
    return {
        "title": task.title,
        "ref": format_task_ref(project.id, task.number),
        "description": task.description,
        "task_type": task.task_type,
        "priority": task.priority,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "status": {"name": status.name, "color": status.color} if status else None,
        "assignees": [
            public_assignee_display(b.full_name, uid)
            for uid, b in briefs.items()
        ],
        "checklists": [cl.model_dump(mode="json") for cl in checklists],
        "searchable": task.public_searchable,
    }


# ---------------------------------------------------------------------------
# Checklists
# ---------------------------------------------------------------------------

@router.get("/tasks/{task_id}/checklists", response_model=list[ChecklistOut])
def list_task_checklists(task_id: uuid.UUID, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    task = _live_task(db, task_id)
    perms.require_task_view(task)
    return _task_checklists(db, task_id)


@router.post("/tasks/{task_id}/checklists", response_model=ChecklistOut, status_code=201)
def create_checklist(task_id: uuid.UUID, body: ChecklistCreate, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    task = _live_task(db, task_id)
    perms.require_task_edit(task)
    pos = db.scalar(select(func.coalesce(func.max(TaskChecklist.position), 0)).where(TaskChecklist.task_id == task_id)) or 0
    cl = TaskChecklist(task_id=task_id, name=body.name, position=pos + 1)
    db.add(cl)
    db.commit()
    out = ChecklistOut.model_validate(cl)
    out.items = []
    return out


def _checklist_task(db: Session, checklist_id: uuid.UUID) -> tuple[TaskChecklist, Task]:
    cl = db.get(TaskChecklist, checklist_id)
    if not cl:
        raise HTTPException(status_code=404, detail="Checklist not found")
    return cl, _live_task(db, cl.task_id)


@router.patch("/checklists/{checklist_id}", response_model=ChecklistOut)
def update_checklist(checklist_id: uuid.UUID, body: ChecklistUpdate, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    cl, task = _checklist_task(db, checklist_id)
    perms.require_task_edit(task)
    cl.name = body.name
    db.commit()
    return next(c for c in _task_checklists(db, cl.task_id) if c.id == cl.id)


@router.delete("/checklists/{checklist_id}", response_model=Message)
def delete_checklist(checklist_id: uuid.UUID, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    cl, task = _checklist_task(db, checklist_id)
    perms.require_task_edit(task)
    db.delete(cl)
    db.commit()
    return Message(detail="Checklist deleted")


@router.post("/checklists/{checklist_id}/items", response_model=ChecklistItemOut, status_code=201)
def add_checklist_item(checklist_id: uuid.UUID, body: ChecklistItemCreate, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    cl, task = _checklist_task(db, checklist_id)
    perms.require_task_edit(task)
    pos = db.scalar(select(func.coalesce(func.max(TaskChecklistItem.position), 0)).where(TaskChecklistItem.checklist_id == checklist_id)) or 0
    item = TaskChecklistItem(checklist_id=checklist_id, content=body.content, position=pos + 1)
    db.add(item)
    db.commit()
    return ChecklistItemOut.model_validate(item)


@router.patch("/checklist-items/{item_id}", response_model=ChecklistItemOut)
def update_checklist_item(item_id: uuid.UUID, body: ChecklistItemUpdate, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    item = db.get(TaskChecklistItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    _, task = _checklist_task(db, item.checklist_id)
    perms.require_task_edit(task)
    if body.content is not None:
        item.content = body.content
    if body.is_done is not None:
        item.is_done = body.is_done
    if body.position is not None:
        item.position = body.position
    db.commit()
    return ChecklistItemOut.model_validate(item)


@router.delete("/checklist-items/{item_id}", response_model=Message)
def delete_checklist_item(item_id: uuid.UUID, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    item = db.get(TaskChecklistItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    _, task = _checklist_task(db, item.checklist_id)
    perms.require_task_edit(task)
    db.delete(item)
    db.commit()
    return Message(detail="Item deleted")


# ---------------------------------------------------------------------------
# Custom fields (project-scoped definitions + per-task values)
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/custom-fields", response_model=list[CustomFieldDefOut])
def list_custom_fields(project_id: uuid.UUID, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    perms.require_project_view(project_id)
    rows = db.scalars(
        select(CustomFieldDefinition).where(CustomFieldDefinition.project_id == project_id)
        .order_by(CustomFieldDefinition.position, CustomFieldDefinition.created_at)
    ).all()
    return [CustomFieldDefOut.model_validate(r) for r in rows]


@router.post("/projects/{project_id}/custom-fields", response_model=CustomFieldDefOut, status_code=201)
def create_custom_field(project_id: uuid.UUID, body: CustomFieldDefCreate, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    perms.require_project_admin(project_id)
    pos = db.scalar(select(func.coalesce(func.max(CustomFieldDefinition.position), 0)).where(CustomFieldDefinition.project_id == project_id)) or 0
    field = CustomFieldDefinition(
        project_id=project_id, name=body.name, field_type=body.field_type,
        options=body.options, position=pos + 1, created_by=perms.user.id,
    )
    db.add(field)
    db.commit()
    return CustomFieldDefOut.model_validate(field)


@router.patch("/custom-fields/{field_id}", response_model=CustomFieldDefOut)
def update_custom_field(field_id: uuid.UUID, body: CustomFieldDefUpdate, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    field = db.get(CustomFieldDefinition, field_id)
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    perms.require_project_admin(field.project_id)
    if body.name is not None:
        field.name = body.name
    if body.options is not None:
        field.options = body.options
    if body.position is not None:
        field.position = body.position
    db.commit()
    return CustomFieldDefOut.model_validate(field)


@router.delete("/custom-fields/{field_id}", response_model=Message)
def delete_custom_field(field_id: uuid.UUID, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    field = db.get(CustomFieldDefinition, field_id)
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    perms.require_project_admin(field.project_id)
    db.delete(field)
    db.commit()
    return Message(detail="Field deleted")


@router.put("/tasks/{task_id}/custom-fields/{field_id}", response_model=CustomFieldValueOut)
def set_custom_field_value(task_id: uuid.UUID, field_id: uuid.UUID, body: CustomFieldValueSet, db: Session = Depends(get_db), perms: PermissionService = Depends(get_permissions)):
    task = _live_task(db, task_id)
    perms.require_task_edit(task)
    field = db.get(CustomFieldDefinition, field_id)
    if not field or field.project_id != task.project_id:
        raise HTTPException(status_code=404, detail="Field not found for this task's project")
    val = db.scalar(
        select(CustomFieldValue).where(
            CustomFieldValue.field_id == field_id, CustomFieldValue.task_id == task_id
        )
    )
    if val:
        val.value = body.value
    else:
        db.add(CustomFieldValue(field_id=field_id, task_id=task_id, value=body.value))
    db.commit()
    return CustomFieldValueOut(field_id=field_id, value=body.value)
