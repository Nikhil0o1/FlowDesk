import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.models.goal import Goal, GoalFolder, GoalFolderShareMember, GoalOwner, GoalShareMember, GoalTargetTask
from app.models.task import Task
from app.schemas.common import Message
from app.schemas.goal import (
    GoalCreate,
    GoalDetailOut,
    GoalFolderAnalyticsOut,
    GoalFolderCreate,
    GoalFolderDetailOut,
    GoalFolderOut,
    GoalFolderShareMemberAdd,
    GoalFolderShareMemberUpdate,
    GoalFolderShareState,
    GoalFolderShareUpdate,
    GoalFolderUpdate,
    GoalAccessOut,
    GoalMove,
    GoalOut,
    GoalProgressOut,
    GoalReorder,
    GoalShareMemberAdd,
    GoalShareState,
    GoalShareUpdate,
    GoalTargetCreate,
    GoalTargetOut,
    GoalTargetSprintAdd,
    GoalTargetSprintOut,
    GoalTargetTaskAdd,
    GoalTargetUpdate,
    GoalTaskLinkOut,
    GoalUpdate,
)
from app.schemas.project import ActivityOut
from app.schemas.task import TaskOut
from app.services import (
    goal_events_service,
    goal_progress_service,
    goal_service,
    goal_task_link_service,
    task_service,
)
from app.services.permission_service import PermissionService

router = APIRouter(tags=["goals"])


@router.get("/workspaces/{workspace_id}/goals/access", response_model=GoalAccessOut)
def get_goals_access(
    workspace_id: uuid.UUID,
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    section_access = perms.has_goals_section_access(workspace_id)
    explicit_access = perms.has_explicit_goal_access(workspace_id)
    return GoalAccessOut(
        section_access=section_access,
        explicit_access=explicit_access,
        can_access=perms.can_access_goals(workspace_id),
    )


@router.get("/workspaces/{workspace_id}/goals", response_model=list[GoalOut])
def list_goals(
    workspace_id: uuid.UUID,
    status: str | None = Query(default=None, pattern="^(draft|active|completed|archived)$"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    if not perms.can_access_goals(workspace_id):
        raise HTTPException(status_code=403, detail="Goals access required")
    query = select(Goal).where(Goal.workspace_id == workspace_id, Goal.deleted_at.is_(None))
    if status:
        query = query.where(Goal.status == status)
    query = perms.apply_goals_list_filter(workspace_id, query)
    goals = db.scalars(query.order_by(Goal.display_order.asc(), Goal.created_at.desc())).all()
    return [goal_service.goal_out(db, goal) for goal in goals]


@router.post("/workspaces/{workspace_id}/goals/reorder", response_model=Message)
def reorder_workspace_goals(
    workspace_id: uuid.UUID,
    body: GoalReorder,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_goal_initiator(workspace_id)
    if body.folder_id is not None:
        folder = goal_service.get_folder_or_404(db, body.folder_id)
        perms.require_goal_folder_view(folder)
        if folder.workspace_id != workspace_id:
            raise HTTPException(status_code=422, detail="Folder not in this workspace")
    goal_service.reorder_goals(
        db,
        workspace_id=workspace_id,
        goal_ids=body.goal_ids,
        folder_id=body.folder_id,
    )
    db.commit()
    return Message(detail="Goals reordered")


@router.post("/workspaces/{workspace_id}/goals", response_model=GoalOut, status_code=201)
def create_goal(
    workspace_id: uuid.UUID,
    body: GoalCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_goal_initiator(workspace_id)
    goal = goal_service.create_goal_record(
        db,
        workspace_id=workspace_id,
        body=body,
        created_by=perms.user.id,
    )
    goal_events_service.log_goal_activity(
        db, goal=goal, action="goal.created", actor_id=perms.user.id
    )
    for oid in body.owner_ids or [goal.owner_id]:
        goal_events_service.notify_goal_owner_assigned(
            db, goal=goal, owner_id=oid, actor=perms.user
        )
    db.commit()
    db.refresh(goal)
    return goal_service.goal_out(db, goal)


@router.get("/goals/{goal_id}", response_model=GoalDetailOut)
def get_goal(
    goal_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_view(goal)
    return goal_service.goal_detail_out(db, goal)


@router.get("/goals/{goal_id}/activity", response_model=list[ActivityOut])
def goal_activity(
    goal_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Timeline of activity entries tagged with this goal_id."""
    from app.models.activity import ActivityLog
    from app.services.user_service import user_briefs

    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_view(goal)
    logs = db.scalars(
        select(ActivityLog)
        .where(
            ActivityLog.workspace_id == goal.workspace_id,
            ActivityLog.data["goal_id"].astext == str(goal.id),
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    ).all()
    briefs = user_briefs(db, [log.actor_id for log in logs if log.actor_id])
    items: list[ActivityOut] = []
    for log in logs:
        out = ActivityOut.model_validate(log)
        out.actor = briefs.get(log.actor_id) if log.actor_id else None
        items.append(out)
    return items


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def update_goal(
    goal_id: uuid.UUID,
    body: GoalUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_manage(goal)
    changes = body.model_dump(exclude_unset=True)
    start = changes.get("start_date", goal.start_date)
    due = changes.get("due_date", goal.due_date)
    goal_service.validate_goal_dates(
        start,
        due,
        existing_start=goal.start_date,
        existing_due=goal.due_date,
    )
    if "owner_id" in changes and changes["owner_id"] is not None:
        goal_service.assert_owner_is_workspace_member(db, goal.workspace_id, changes["owner_id"])
    if "folder_id" in changes:
        goal_service.assert_folder_in_workspace(db, goal.workspace_id, changes["folder_id"])
    prev_status = goal.status
    prev_owner_ids = set(goal_service.goal_owner_ids(db, goal.id) or [goal.owner_id])
    owner_ids = changes.pop("owner_ids", None)
    for field, value in changes.items():
        setattr(goal, field, value)
    if owner_ids is not None:
        prev_owner_ids = set(
            goal_service.set_goal_owners(db, goal, owner_ids, created_by=perms.user.id)
        )
    elif "owner_id" in changes and goal.owner_id is not None:
        # Single primary change — keep other co-owners, ensure primary is in set
        current = goal_service.goal_owner_ids(db, goal.id)
        if goal.owner_id not in current:
            current = [goal.owner_id, *current]
        else:
            current = [goal.owner_id, *[u for u in current if u != goal.owner_id]]
        prev_owner_ids = set(
            goal_service.set_goal_owners(db, goal, current, created_by=perms.user.id)
        )
    action = "goal.updated"
    if "status" in changes and changes["status"] == "archived":
        action = "goal.archived"
    elif "status" in changes and prev_status == "archived" and goal.status != "archived":
        action = "goal.unarchived"
    goal_events_service.log_goal_activity(
        db, goal=goal, action=action, actor_id=perms.user.id, extra={"changes": list(changes.keys()) + (["owner_ids"] if owner_ids is not None else [])}
    )
    if prev_status != "completed" and goal.status == "completed":
        for oid in goal_service.goal_owner_ids(db, goal.id) or [goal.owner_id]:
            goal_events_service.notify_goal_completed(
                db, goal=goal, user_id=oid, actor_id=perms.user.id
            )
    new_owner_ids = set(goal_service.goal_owner_ids(db, goal.id) or [goal.owner_id])
    for oid in new_owner_ids - prev_owner_ids:
        goal_events_service.notify_goal_owner_assigned(
            db, goal=goal, owner_id=oid, actor=perms.user
        )
    db.commit()
    db.refresh(goal)
    return goal_service.goal_out(db, goal)


@router.post("/goals/{goal_id}/move", response_model=GoalOut)
def move_goal(
    goal_id: uuid.UUID,
    body: GoalMove,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_manage(goal)
    prev_folder = goal.folder_id
    goal_service.move_goal_to_folder(db, goal, body.folder_id)
    goal_events_service.log_goal_activity(
        db,
        goal=goal,
        action="goal.moved",
        actor_id=perms.user.id,
        extra={
            "from_folder_id": str(prev_folder) if prev_folder else None,
            "to_folder_id": str(goal.folder_id) if goal.folder_id else None,
        },
    )
    db.commit()
    db.refresh(goal)
    return goal_service.goal_out(db, goal)


@router.get("/workspaces/{workspace_id}/goal-folders", response_model=list[GoalFolderOut])
def list_goal_folders(
    workspace_id: uuid.UUID,
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    if not perms.can_access_goals(workspace_id):
        raise HTTPException(status_code=403, detail="Goals access required")
    query = select(GoalFolder).where(GoalFolder.workspace_id == workspace_id)
    if not include_archived:
        query = query.where(GoalFolder.is_archived.is_(False))
    query = perms.apply_goal_folders_list_filter(workspace_id, query)
    rows = db.scalars(query.order_by(GoalFolder.updated_at.desc())).all()
    stats = goal_service._folder_goal_stats(db, [f.id for f in rows])
    return [
        goal_service.folder_out(db, folder, stats=stats.get(folder.id, goal_service._empty_folder_stats()))
        for folder in rows
    ]


@router.post("/workspaces/{workspace_id}/goal-folders", response_model=GoalFolderOut, status_code=201)
def create_goal_folder(
    workspace_id: uuid.UUID,
    body: GoalFolderCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_goal_initiator(workspace_id)
    folder = goal_service.create_folder(
        db,
        workspace_id,
        name=body.name,
        description=body.description,
        color=body.color,
        created_by=perms.user.id,
        is_private=body.is_private,
    )
    goal_events_service.log_folder_activity(
        db, folder=folder, action="goal_folder.created", actor_id=perms.user.id
    )
    db.commit()
    db.refresh(folder)
    return goal_service.folder_out(db, folder)


@router.get("/goal-folders/{folder_id}", response_model=GoalFolderDetailOut)
def get_goal_folder(
    folder_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_view(folder)
    goals_query = goal_service.goals_in_folder_query(folder.id)
    goals_query = perms.apply_goals_list_filter(folder.workspace_id, goals_query)
    goals = db.scalars(goals_query.order_by(Goal.display_order.asc(), Goal.updated_at.desc())).all()
    return goal_service.folder_detail_out(db, folder, list(goals))


@router.patch("/goal-folders/{folder_id}", response_model=GoalFolderOut)
def update_goal_folder(
    folder_id: uuid.UUID,
    body: GoalFolderUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_manage(folder)
    changes = body.model_dump(exclude_unset=True)
    was_archived = folder.is_archived
    goal_service.update_folder(folder, changes)
    action = "goal_folder.updated"
    if "is_archived" in changes:
        action = "goal_folder.archived" if folder.is_archived and not was_archived else (
            "goal_folder.unarchived" if not folder.is_archived and was_archived else action
        )
    goal_events_service.log_folder_activity(
        db, folder=folder, action=action, actor_id=perms.user.id
    )
    db.commit()
    db.refresh(folder)
    return goal_service.folder_out(db, folder)


@router.delete("/goal-folders/{folder_id}", response_model=Message)
def delete_goal_folder(
    folder_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_manage(folder)
    goal_events_service.log_folder_activity(
        db,
        folder=folder,
        action="goal_folder.deleted",
        actor_id=perms.user.id,
        extra={"name": folder.name},
    )
    goal_service.delete_folder(db, folder)
    db.commit()
    return Message(detail="Folder deleted")


@router.get("/goal-folders/{folder_id}/share", response_model=GoalFolderShareState)
def get_goal_folder_share(
    folder_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_view(folder)
    return goal_service.folder_share_state(db, folder)


@router.patch("/goal-folders/{folder_id}/share", response_model=GoalFolderShareState)
def update_goal_folder_share(
    folder_id: uuid.UUID,
    body: GoalFolderShareUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_share_manage(folder)
    if body.is_private is not None:
        folder.is_private = body.is_private
    goal_events_service.log_folder_activity(
        db,
        folder=folder,
        action="goal_folder.share_updated",
        actor_id=perms.user.id,
        extra={"is_private": folder.is_private},
    )
    db.commit()
    db.refresh(folder)
    return goal_service.folder_share_state(db, folder)


@router.post("/goal-folders/{folder_id}/share/members", response_model=GoalFolderShareState, status_code=201)
def add_goal_folder_share_member(
    folder_id: uuid.UUID,
    body: GoalFolderShareMemberAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_share_manage(folder)
    goal_service.assert_owner_is_workspace_member(db, folder.workspace_id, body.user_id)
    existing = db.scalar(
        select(GoalFolderShareMember).where(
            GoalFolderShareMember.folder_id == folder.id,
            GoalFolderShareMember.user_id == body.user_id,
        )
    )
    is_new = existing is None
    if existing:
        existing.role = body.role
    else:
        db.add(
            GoalFolderShareMember(
                folder_id=folder.id,
                user_id=body.user_id,
                role=body.role,
                created_by=perms.user.id,
            )
        )
    if is_new and body.user_id != perms.user.id:
        actor_name = (
            perms.user.profile.full_name
            if perms.user.profile and perms.user.profile.full_name
            else perms.user.email
        )
        goal_events_service.notify_folder_shared(
            db, folder=folder, user_id=body.user_id, actor_name=actor_name
        )
    goal_events_service.log_folder_activity(
        db,
        folder=folder,
        action="goal_folder.member_added",
        actor_id=perms.user.id,
        extra={"user_id": str(body.user_id), "role": body.role},
    )
    db.commit()
    db.refresh(folder)
    return goal_service.folder_share_state(db, folder)


@router.delete("/goal-folders/{folder_id}/share/members/{user_id}", response_model=GoalFolderShareState)
def remove_goal_folder_share_member(
    folder_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_share_manage(folder)
    row = db.scalar(
        select(GoalFolderShareMember).where(
            GoalFolderShareMember.folder_id == folder.id,
            GoalFolderShareMember.user_id == user_id,
        )
    )
    if row:
        db.delete(row)
        goal_events_service.log_folder_activity(
            db,
            folder=folder,
            action="goal_folder.member_removed",
            actor_id=perms.user.id,
            extra={"user_id": str(user_id)},
        )
    db.commit()
    return goal_service.folder_share_state(db, folder)


@router.patch("/goal-folders/{folder_id}/share/members/{user_id}", response_model=GoalFolderShareState)
def update_goal_folder_share_member(
    folder_id: uuid.UUID,
    user_id: uuid.UUID,
    body: GoalFolderShareMemberUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_share_manage(folder)
    member = db.scalar(
        select(GoalFolderShareMember).where(
            GoalFolderShareMember.folder_id == folder.id,
            GoalFolderShareMember.user_id == user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Share member not found")
    member.role = body.role
    goal_events_service.log_folder_activity(
        db,
        folder=folder,
        action="goal_folder.member_updated",
        actor_id=perms.user.id,
        extra={"user_id": str(user_id), "role": body.role},
    )
    db.commit()
    db.refresh(folder)
    return goal_service.folder_share_state(db, folder)


@router.get("/goal-folders/{folder_id}/analytics", response_model=GoalFolderAnalyticsOut)
def get_goal_folder_analytics(
    folder_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_view(folder)
    return goal_service.folder_analytics_out(db, folder)


@router.get("/goal-folders/{folder_id}/goals", response_model=list[GoalOut])
def list_folder_goals(
    folder_id: uuid.UUID,
    status: str | None = Query(default=None, pattern="^(draft|active|completed|archived)$"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_view(folder)
    query = goal_service.goals_in_folder_query(folder.id)
    if status:
        query = query.where(Goal.status == status)
    query = perms.apply_goals_list_filter(folder.workspace_id, query)
    goals = db.scalars(query.order_by(Goal.display_order.asc(), Goal.updated_at.desc())).all()
    return [goal_service.goal_out(db, goal) for goal in goals]


@router.post("/goal-folders/{folder_id}/goals", response_model=GoalOut, status_code=201)
def create_goal_in_folder(
    folder_id: uuid.UUID,
    body: GoalCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = goal_service.get_folder_or_404(db, folder_id)
    perms.require_goal_folder_view(folder)
    perms.require_goal_initiator(folder.workspace_id)
    goal = goal_service.create_goal_record(
        db,
        workspace_id=folder.workspace_id,
        body=body,
        created_by=perms.user.id,
        folder_id=folder.id,
    )
    goal_events_service.log_goal_activity(
        db,
        goal=goal,
        action="goal.created",
        actor_id=perms.user.id,
        extra={"folder_id": str(folder.id)},
    )
    for oid in body.owner_ids or [goal.owner_id]:
        goal_events_service.notify_goal_owner_assigned(
            db, goal=goal, owner_id=oid, actor=perms.user
        )
    db.commit()
    db.refresh(goal)
    return goal_service.goal_out(db, goal)


@router.delete("/goals/{goal_id}", response_model=Message)
def delete_goal(
    goal_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_manage(goal)
    goal_events_service.log_goal_activity(
        db, goal=goal, action="goal.deleted", actor_id=perms.user.id
    )
    goal_service.remove_goal_targets(db, goal.id)
    goal.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Message(detail="Goal deleted")


@router.get("/goals/{goal_id}/progress", response_model=GoalProgressOut)
def get_goal_progress(
    goal_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_view(goal)
    return goal_service.goal_progress_out(db, goal)


@router.get("/goals/{goal_id}/share", response_model=GoalShareState)
def get_goal_share(
    goal_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_view(goal)
    state = goal_service.share_state(db, goal)
    db.commit()
    return state


@router.patch("/goals/{goal_id}/share", response_model=GoalShareState)
def update_goal_share(
    goal_id: uuid.UUID,
    body: GoalShareUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_share_manage(goal)
    if body.is_private is not None:
        goal.is_private = body.is_private
    goal_service.ensure_share_token(goal)
    db.commit()
    db.refresh(goal)
    return goal_service.share_state(db, goal)


@router.post("/goals/{goal_id}/share/members", response_model=GoalShareState, status_code=201)
def add_goal_share_member(
    goal_id: uuid.UUID,
    body: GoalShareMemberAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_share_manage(goal)
    goal_service.assert_owner_is_workspace_member(db, goal.workspace_id, body.user_id)
    existing = db.scalar(
        select(GoalShareMember).where(
            GoalShareMember.goal_id == goal.id,
            GoalShareMember.user_id == body.user_id,
        )
    )
    if existing:
        existing.role = body.role
    else:
        db.add(
            GoalShareMember(
                goal_id=goal.id,
                user_id=body.user_id,
                role=body.role,
                created_by=perms.user.id,
            )
        )
        if body.user_id != perms.user.id:
            actor_name = (
                perms.user.profile.full_name
                if perms.user.profile and perms.user.profile.full_name
                else perms.user.email
            )
            goal_events_service.notify_goal_shared(
                db, goal=goal, user_id=body.user_id, actor_name=actor_name
            )
    goal_service.ensure_share_token(goal)
    goal_events_service.log_goal_activity(
        db,
        goal=goal,
        action="goal.member_added",
        actor_id=perms.user.id,
        extra={"user_id": str(body.user_id), "role": body.role},
    )
    db.commit()
    db.refresh(goal)
    return goal_service.share_state(db, goal)


@router.delete("/goals/{goal_id}/share/members/{user_id}", response_model=GoalShareState)
def remove_goal_share_member(
    goal_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_share_manage(goal)
    member = db.scalar(
        select(GoalShareMember).where(
            GoalShareMember.goal_id == goal.id,
            GoalShareMember.user_id == user_id,
        )
    )
    if member:
        db.delete(member)
        goal_events_service.log_goal_activity(
            db,
            goal=goal,
            action="goal.member_removed",
            actor_id=perms.user.id,
            extra={"user_id": str(user_id)},
        )
    db.commit()
    db.refresh(goal)
    return goal_service.share_state(db, goal)


@router.post("/goals/{goal_id}/targets", response_model=GoalTargetOut, status_code=201)
def create_target(
    goal_id: uuid.UUID,
    body: GoalTargetCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    goal = goal_service.get_goal_or_404(db, goal_id)
    perms.require_goal_manage(goal)
    target = goal_service.create_target_from_body(db, goal, body)
    goal_events_service.log_goal_activity(
        db,
        goal=goal,
        action="goal.target_created",
        actor_id=perms.user.id,
        extra={
            "target_id": str(target.id),
            "target_type": target.target_type,
            "target_title": target.title,
        },
    )
    if target.owner_id:
        for oid in body.owner_ids or [target.owner_id]:
            goal_events_service.notify_target_owner_assigned(
                db, goal=goal, target=target, owner_id=oid, actor=perms.user
            )
    db.commit()
    db.refresh(target)
    goal_progress_service.emit_goal_updated(goal)
    return goal_service.target_out(db, target)


@router.patch("/targets/{target_id}", response_model=GoalTargetOut)
def update_target(
    target_id: uuid.UUID,
    body: GoalTargetUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    target = goal_service.get_target_or_404(db, target_id)
    goal = goal_service.get_goal_or_404(db, target.goal_id)
    perms.require_goal_manage(goal)
    changes = body.model_dump(exclude_unset=True)
    owner_ids = changes.pop("owner_ids", None)
    if "owner_id" in changes and changes["owner_id"] is not None:
        goal_service.assert_owner_is_workspace_member(db, goal.workspace_id, changes["owner_id"])
    prev_owner_ids = set(goal_service.target_owner_ids(db, target.id) or ([target.owner_id] if target.owner_id else []))
    for field, value in changes.items():
        setattr(target, field, value)
    if owner_ids is not None:
        prev_owner_ids = set(
            goal_service.set_target_owners(db, goal, target, owner_ids, created_by=perms.user.id)
        )
    elif "owner_id" in changes and target.owner_id is not None:
        current = goal_service.target_owner_ids(db, target.id)
        if target.owner_id not in current:
            current = [target.owner_id, *current]
        else:
            current = [target.owner_id, *[u for u in current if u != target.owner_id]]
        prev_owner_ids = set(
            goal_service.set_target_owners(db, goal, target, current, created_by=perms.user.id)
        )
    goal_progress_service.recalculate_target_progress(db, target.id)
    goal_progress_service.recalculate_goal_progress(db, goal.id)
    new_owner_ids = set(goal_service.target_owner_ids(db, target.id) or ([target.owner_id] if target.owner_id else []))
    for oid in new_owner_ids - prev_owner_ids:
        goal_events_service.notify_target_owner_assigned(
            db, goal=goal, target=target, owner_id=oid, actor=perms.user
        )
    db.commit()
    db.refresh(target)
    db.refresh(goal)
    goal_progress_service.emit_goal_updated(goal)
    return goal_service.target_out(db, target)


@router.delete("/targets/{target_id}", response_model=Message)
def delete_target(
    target_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    target = goal_service.get_target_or_404(db, target_id)
    goal = goal_service.get_goal_or_404(db, target.goal_id)
    perms.require_goal_manage(goal)
    goal_id = goal.id
    db.delete(target)
    db.flush()
    updated_goal = goal_progress_service.recalculate_goal_progress(db, goal_id)
    db.commit()
    if updated_goal:
        goal_progress_service.emit_goal_updated(updated_goal)
    return Message(detail="Target deleted")


@router.get("/workspaces/{workspace_id}/goal-task-links", response_model=list[GoalTaskLinkOut])
def list_workspace_goal_task_links(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Tasks already linked to any goal in the workspace (for picker filtering)."""
    perms.require_goals_section_access(workspace_id)
    return [
        GoalTaskLinkOut(**row)
        for row in goal_task_link_service.list_workspace_task_links(db, workspace_id)
    ]


@router.get("/targets/{target_id}/tasks", response_model=list[TaskOut])
def list_target_tasks(
    target_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    target = goal_service.get_target_or_404(db, target_id)
    goal = goal_service.get_goal_or_404(db, target.goal_id)
    perms.require_goal_view(goal)
    tasks = db.scalars(
        select(Task)
        .join(GoalTargetTask, GoalTargetTask.task_id == Task.id)
        .where(
            GoalTargetTask.goal_target_id == target.id,
            Task.deleted_at.is_(None),
            perms.visible_task_filter(),
        )
        .order_by(Task.position)
    ).all()
    outs: list[TaskOut] = []
    by_project: dict[uuid.UUID, list[Task]] = {}
    for task in tasks:
        by_project.setdefault(task.project_id, []).append(task)
    for project_id, project_tasks in by_project.items():
        project = perms.get_project_or_404(project_id)
        outs.extend(task_service.build_task_outs(db, project, project_tasks))
    return outs


@router.post("/targets/{target_id}/tasks", response_model=Message)
def link_target_tasks(
    target_id: uuid.UUID,
    body: GoalTargetTaskAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    target = goal_service.get_target_or_404(db, target_id)
    goal = goal_service.get_goal_or_404(db, target.goal_id)
    perms.require_goal_manage(goal)
    if target.target_type != "tasks":
        raise HTTPException(status_code=422, detail="Only task-type targets can link tasks")
    added = goal_task_link_service.link_tasks(db, perms, target, goal, body.task_ids)
    if added:
        goal_events_service.log_goal_activity(
            db,
            goal=goal,
            action="goal.tasks_linked",
            actor_id=perms.user.id,
            extra={"target_id": str(target.id), "count": added},
        )
    db.commit()
    db.refresh(goal)
    if added:
        goal_progress_service.emit_goal_updated(goal, extra={"tasks_linked": added})
    return Message(detail=f"{added} task(s) linked to target")


@router.delete("/targets/{target_id}/tasks/{task_id}", response_model=Message)
def unlink_target_task(
    target_id: uuid.UUID,
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    target = goal_service.get_target_or_404(db, target_id)
    goal = goal_service.get_goal_or_404(db, target.goal_id)
    perms.require_goal_manage(goal)
    goal_task_link_service.unlink_task(db, target, goal, task_id)
    goal_events_service.log_goal_activity(
        db,
        goal=goal,
        action="goal.task_unlinked",
        actor_id=perms.user.id,
        extra={"target_id": str(target.id), "task_id": str(task_id)},
    )
    db.commit()
    db.refresh(goal)
    goal_progress_service.emit_goal_updated(goal, extra={"task_unlinked": str(task_id)})
    return Message(detail="Task unlinked from target")


@router.get("/targets/{target_id}/sprints", response_model=list[GoalTargetSprintOut])
def list_target_sprints(
    target_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    target = goal_service.get_target_or_404(db, target_id)
    goal = goal_service.get_goal_or_404(db, target.goal_id)
    perms.require_goal_view(goal)
    sprints = goal_task_link_service.list_linked_sprints(db, target.id)
    outs: list[GoalTargetSprintOut] = []
    for sprint in sprints:
        outs.append(
            GoalTargetSprintOut(
                sprint_id=sprint.id,
                name=sprint.name,
                status=sprint.status,
                task_count=len(goal_task_link_service.sprint_task_ids(db, sprint.id)),
                start_date=sprint.start_date,
                end_date=sprint.end_date,
            )
        )
    return outs


@router.post("/targets/{target_id}/sprints", response_model=Message, status_code=201)
def link_target_sprint(
    target_id: uuid.UUID,
    body: GoalTargetSprintAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    target = goal_service.get_target_or_404(db, target_id)
    goal = goal_service.get_goal_or_404(db, target.goal_id)
    perms.require_goal_manage(goal)
    added, newly = goal_task_link_service.link_sprint(db, perms, target, goal, body.sprint_id)
    goal_events_service.log_goal_activity(
        db,
        goal=goal,
        action="goal.sprint_linked",
        actor_id=perms.user.id,
        extra={
            "target_id": str(target.id),
            "sprint_id": str(body.sprint_id),
            "tasks_linked": added,
            "newly_linked": newly,
        },
    )
    db.commit()
    db.refresh(goal)
    if added:
        goal_progress_service.emit_goal_updated(
            goal, extra={"sprint_linked": str(body.sprint_id), "tasks_linked": added}
        )
    return Message(detail=f"List linked · {added} task(s) added to target")


@router.delete("/targets/{target_id}/sprints/{sprint_id}", response_model=Message)
def unlink_target_sprint(
    target_id: uuid.UUID,
    sprint_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    target = goal_service.get_target_or_404(db, target_id)
    goal = goal_service.get_goal_or_404(db, target.goal_id)
    perms.require_goal_manage(goal)
    goal_task_link_service.unlink_sprint(db, target, goal, sprint_id)
    goal_events_service.log_goal_activity(
        db,
        goal=goal,
        action="goal.sprint_unlinked",
        actor_id=perms.user.id,
        extra={"target_id": str(target.id), "sprint_id": str(sprint_id)},
    )
    db.commit()
    return Message(detail="List unlinked from target")
