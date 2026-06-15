import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.models.activity import ActivityLog
from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space, TaskList
from app.models.task import CustomStatus, Task
from app.models.workspace import WorkspaceMember
from app.schemas.common import Message, Page
from app.schemas.organization import InviteOut
from app.schemas.project import (
    ActivityOut,
    CustomStatusCreate,
    CustomStatusOut,
    CustomStatusUpdate,
    ProjectCreate,
    ProjectInviteCreate,
    ProjectMemberAdd,
    ProjectMemberOut,
    ProjectOut,
    ProjectUpdate,
    SpaceCreate,
    SpaceOut,
    SpaceUpdate,
    TaskListCreate,
    TaskListOut,
    TaskListUpdate,
)
from app.services import invite_service
from app.services.activity_service import log_activity
from app.services.audit_service import audit
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["projects"])

DEFAULT_STATUSES = [
    ("To Do", "#87909E", "todo", 0),
    ("In Progress", "#5B9FF0", "in_progress", 1),
    ("In Review", "#B07BE0", "in_progress", 2),
    ("Done", "#4CB782", "done", 3),
]


# ---------------- Spaces ----------------

@router.get("/workspaces/{workspace_id}/spaces", response_model=list[SpaceOut])
def list_spaces(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    spaces = db.scalars(
        select(Space)
        .where(Space.workspace_id == workspace_id, Space.deleted_at.is_(None))
        .order_by(Space.position, Space.created_at)
    ).all()
    return [SpaceOut.model_validate(s) for s in spaces]


@router.post("/workspaces/{workspace_id}/spaces", response_model=SpaceOut, status_code=201)
def create_space(
    workspace_id: uuid.UUID,
    body: SpaceCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_admin(workspace_id)
    space = Space(
        workspace_id=workspace_id, name=body.name, color=body.color, icon=body.icon,
        created_by=perms.user.id,
    )
    db.add(space)
    db.flush()
    log_activity(db, workspace_id=workspace_id, action="space.created",
                 actor_id=perms.user.id, data={"space_id": str(space.id), "name": space.name})
    audit(db, "space.created", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="space", target_id=space.id, data={"name": space.name})
    db.commit()
    return SpaceOut.model_validate(space)


@router.patch("/spaces/{space_id}", response_model=SpaceOut)
def update_space(
    space_id: uuid.UUID,
    body: SpaceUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    space = db.get(Space, space_id)
    if not space or space.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Space not found")
    perms.require_workspace_admin(space.workspace_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(space, field, value)
    db.commit()
    return SpaceOut.model_validate(space)


@router.delete("/spaces/{space_id}", response_model=Message)
def delete_space(
    space_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    space = db.get(Space, space_id)
    if not space or space.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Space not found")
    ws = perms.require_workspace_admin(space.workspace_id)
    space.deleted_at = datetime.now(timezone.utc)
    audit(db, "space.deleted", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="space", target_id=space.id, data={"name": space.name})
    db.commit()
    return Message(detail="Space deleted")


# ---------------- Projects ----------------

def _project_out(db: Session, project: Project, my_role: str | None) -> ProjectOut:
    out = ProjectOut.model_validate(project)
    out.my_role = my_role
    out.task_count = db.scalar(
        select(func.count(Task.id)).where(
            Task.project_id == project.id, Task.deleted_at.is_(None),
            Task.is_archived.is_(False), Task.parent_task_id.is_(None),
        )
    )
    out.done_task_count = db.scalar(
        select(func.count(Task.id)).where(
            Task.project_id == project.id, Task.deleted_at.is_(None),
            Task.is_archived.is_(False), Task.parent_task_id.is_(None),
            Task.completed_at.is_not(None),
        )
    )
    return out


@router.get("/workspaces/{workspace_id}/projects", response_model=list[ProjectOut])
def list_projects(
    workspace_id: uuid.UUID,
    space_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    ws = perms.require_workspace_member(workspace_id)
    is_admin = (
        perms.workspace_role(workspace_id) in ("admin", "owner")
        or perms.org_role(ws.organization_id) == "owner"
    )
    query = select(Project).where(
        Project.workspace_id == workspace_id, Project.deleted_at.is_(None)
    )
    if space_id:
        query = query.where(Project.space_id == space_id)
    if not is_admin:
        # Members only see projects they're assigned to
        member_project_ids = select(ProjectMember.project_id).where(
            ProjectMember.user_id == perms.user.id
        )
        query = query.where(Project.id.in_(member_project_ids))
    projects = db.scalars(query.order_by(Project.position, Project.created_at)).all()
    roles = {
        pm.project_id: pm.role
        for pm in db.scalars(
            select(ProjectMember).where(ProjectMember.user_id == perms.user.id)
        ).all()
    }
    return [
        _project_out(db, p, roles.get(p.id, "admin" if is_admin else None)) for p in projects
    ]


@router.post("/spaces/{space_id}/projects", response_model=ProjectOut, status_code=201)
def create_project(
    space_id: uuid.UUID,
    body: ProjectCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    space = db.get(Space, space_id)
    if not space or space.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Space not found")
    ws = perms.require_workspace_admin(space.workspace_id)
    key = body.key.upper()
    existing = db.scalar(
        select(Project).where(
            Project.workspace_id == space.workspace_id, Project.key == key,
            Project.deleted_at.is_(None),
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"Project key '{key}' is already in use in this workspace")
    project = Project(
        space_id=space_id,
        workspace_id=space.workspace_id,
        name=body.name,
        key=key,
        description=body.description,
        color=body.color,
        icon=body.icon,
        created_by=perms.user.id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=perms.user.id, role="admin"))
    for name, color, category, position in DEFAULT_STATUSES:
        db.add(CustomStatus(project_id=project.id, name=name, color=color, category=category, position=position))
    db.add(TaskList(project_id=project.id, name="Tasks", position=0, created_by=perms.user.id))
    log_activity(db, workspace_id=space.workspace_id, action="project.created",
                 actor_id=perms.user.id, project_id=project.id, data={"name": project.name})
    audit(db, "project.created", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="project", target_id=project.id, data={"name": project.name, "key": key})
    db.commit()
    return _project_out(db, project, "admin")


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_view(project_id)
    return _project_out(db, project, perms.project_role(project_id))


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("is_archived") is True and not project.is_archived:
        project.archived_at = datetime.now(timezone.utc)
    for field, value in changes.items():
        setattr(project, field, value)
    log_activity(db, workspace_id=project.workspace_id, action="project.updated",
                 actor_id=perms.user.id, project_id=project.id, data={"fields": list(changes)})
    db.commit()
    return _project_out(db, project, perms.project_role(project_id))


@router.delete("/projects/{project_id}", response_model=Message)
def delete_project(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.get_project_or_404(project_id)
    ws = perms.require_workspace_admin(project.workspace_id)
    project.deleted_at = datetime.now(timezone.utc)
    audit(db, "project.deleted", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="project", target_id=project.id, data={"name": project.name})
    db.commit()
    return Message(detail="Project deleted")


# ---------------- Project members ----------------

@router.get("/projects/{project_id}/members", response_model=list[ProjectMemberOut])
def list_project_members(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    members = db.scalars(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.created_at)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    result = []
    for m in members:
        out = ProjectMemberOut.model_validate(m)
        out.user = briefs.get(m.user_id)
        result.append(out)
    return result


@router.post("/projects/{project_id}/members", response_model=ProjectMemberOut, status_code=201)
def add_project_member(
    project_id: uuid.UUID,
    body: ProjectMemberAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    # User must already belong to the organization
    ws_org = perms.get_workspace_or_404(project.workspace_id).organization_id
    in_org = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == ws_org,
            OrganizationMember.user_id == body.user_id,
        )
    )
    if not in_org:
        raise HTTPException(
            status_code=400,
            detail="User is not part of this organization. Send them an invitation instead.",
        )
    if db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == body.user_id
        )
    ):
        raise HTTPException(status_code=409, detail="User is already a project member")
    member = ProjectMember(project_id=project_id, user_id=body.user_id, role=body.role)
    db.add(member)
    # Ensure workspace membership for visibility
    if not db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == project.workspace_id,
            WorkspaceMember.user_id == body.user_id,
        )
    ):
        db.add(WorkspaceMember(workspace_id=project.workspace_id, user_id=body.user_id, role="member"))
    db.flush()
    log_activity(db, workspace_id=project.workspace_id, action="project.member_added",
                 actor_id=perms.user.id, project_id=project_id, data={"user_id": str(body.user_id)})
    db.commit()
    out = ProjectMemberOut.model_validate(member)
    out.user = user_briefs(db, [member.user_id]).get(member.user_id)
    return out


@router.delete("/projects/{project_id}/members/{member_user_id}", response_model=Message)
def remove_project_member(
    project_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == member_user_id
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    log_activity(db, workspace_id=project.workspace_id, action="project.member_removed",
                 actor_id=perms.user.id, project_id=project_id, data={"user_id": str(member_user_id)})
    db.commit()
    return Message(detail="Member removed")


@router.post("/projects/{project_id}/invites", response_model=InviteOut, status_code=201)
@limiter.limit("20/minute")
def create_project_invite(
    request: Request,
    project_id: uuid.UUID,
    body: ProjectInviteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_can_invite_to_project(project_id)
    ws = perms.get_workspace_or_404(project.workspace_id)
    invite = invite_service.create_invite(
        db, inviter=perms.user, email=body.email, scope="project",
        role=body.role, organization_id=ws.organization_id,
        workspace_id=project.workspace_id, project_id=project_id,
    )
    return InviteOut.model_validate(invite)


# ---------------- Task lists ----------------

@router.get("/projects/{project_id}/lists", response_model=list[TaskListOut])
def list_task_lists(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    lists = db.scalars(
        select(TaskList)
        .where(TaskList.project_id == project_id, TaskList.deleted_at.is_(None))
        .order_by(TaskList.position, TaskList.created_at)
    ).all()
    return [TaskListOut.model_validate(l) for l in lists]


@router.post("/projects/{project_id}/lists", response_model=TaskListOut, status_code=201)
def create_task_list(
    project_id: uuid.UUID,
    body: TaskListCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    project = perms.require_project_admin(project_id)
    max_pos = db.scalar(
        select(func.coalesce(func.max(TaskList.position), -1)).where(TaskList.project_id == project_id)
    )
    task_list = TaskList(project_id=project_id, name=body.name, position=max_pos + 1, created_by=perms.user.id)
    db.add(task_list)
    db.flush()
    log_activity(db, workspace_id=project.workspace_id, action="list.created",
                 actor_id=perms.user.id, project_id=project_id, data={"name": body.name})
    db.commit()
    return TaskListOut.model_validate(task_list)


@router.patch("/lists/{list_id}", response_model=TaskListOut)
def update_task_list(
    list_id: uuid.UUID,
    body: TaskListUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task_list = db.get(TaskList, list_id)
    if not task_list or task_list.deleted_at is not None:
        raise HTTPException(status_code=404, detail="List not found")
    perms.require_project_admin(task_list.project_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(task_list, field, value)
    db.commit()
    return TaskListOut.model_validate(task_list)


@router.delete("/lists/{list_id}", response_model=Message)
def delete_task_list(
    list_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task_list = db.get(TaskList, list_id)
    if not task_list or task_list.deleted_at is not None:
        raise HTTPException(status_code=404, detail="List not found")
    perms.require_project_admin(task_list.project_id)
    task_list.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Message(detail="List deleted")


# ---------------- Custom statuses ----------------

@router.get("/projects/{project_id}/statuses", response_model=list[CustomStatusOut])
def list_statuses(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    statuses = db.scalars(
        select(CustomStatus)
        .where(CustomStatus.project_id == project_id)
        .order_by(CustomStatus.position)
    ).all()
    return [CustomStatusOut.model_validate(s) for s in statuses]


@router.post("/projects/{project_id}/statuses", response_model=CustomStatusOut, status_code=201)
def create_status(
    project_id: uuid.UUID,
    body: CustomStatusCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_admin(project_id)
    max_pos = db.scalar(
        select(func.coalesce(func.max(CustomStatus.position), -1)).where(
            CustomStatus.project_id == project_id
        )
    )
    status = CustomStatus(
        project_id=project_id, name=body.name, color=body.color,
        category=body.category, position=max_pos + 1,
    )
    db.add(status)
    db.commit()
    return CustomStatusOut.model_validate(status)


@router.patch("/statuses/{status_id}", response_model=CustomStatusOut)
def update_status(
    status_id: uuid.UUID,
    body: CustomStatusUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    status = db.get(CustomStatus, status_id)
    if not status:
        raise HTTPException(status_code=404, detail="Status not found")
    perms.require_project_admin(status.project_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(status, field, value)
    db.commit()
    return CustomStatusOut.model_validate(status)


@router.delete("/statuses/{status_id}", response_model=Message)
def delete_status(
    status_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    status = db.get(CustomStatus, status_id)
    if not status:
        raise HTTPException(status_code=404, detail="Status not found")
    perms.require_project_admin(status.project_id)
    in_use = db.scalar(select(func.count(Task.id)).where(Task.status_id == status_id))
    if in_use:
        raise HTTPException(status_code=409, detail=f"{in_use} task(s) still use this status")
    db.delete(status)
    db.commit()
    return Message(detail="Status deleted")


# ---------------- Activity feed ----------------

@router.get("/projects/{project_id}/activity", response_model=Page[ActivityOut])
def project_activity(
    project_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_project_view(project_id)
    base = select(ActivityLog).where(ActivityLog.project_id == project_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    logs = db.scalars(
        base.order_by(ActivityLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    briefs = user_briefs(db, [l.actor_id for l in logs if l.actor_id])
    items = []
    for log in logs:
        out = ActivityOut.model_validate(log)
        out.actor = briefs.get(log.actor_id) if log.actor_id else None
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)
