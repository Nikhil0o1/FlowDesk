"""Link and unlink tasks on goal targets."""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.goal import Goal, GoalTarget, GoalTargetSprint, GoalTargetTask
from app.models.sprint import Sprint, SprintTask
from app.models.task import Task
from app.services import goal_progress_service
from app.services.permission_service import NotFound404, PermissionError403, PermissionService


def existing_goal_for_task(db: Session, task_id: uuid.UUID) -> tuple[Goal, uuid.UUID] | None:
    row = db.execute(
        select(Goal, GoalTargetTask.goal_target_id)
        .join(GoalTarget, GoalTarget.id == GoalTargetTask.goal_target_id)
        .join(Goal, Goal.id == GoalTarget.goal_id)
        .where(GoalTargetTask.task_id == task_id, Goal.deleted_at.is_(None))
    ).first()
    if not row:
        return None
    goal, linked_target_id = row
    return goal, linked_target_id


def list_workspace_task_links(db: Session, workspace_id: uuid.UUID) -> list[dict]:
    rows = db.execute(
        select(
            GoalTargetTask.task_id,
            Goal.id,
            Goal.name,
            GoalTarget.id,
            GoalTarget.title,
        )
        .join(GoalTarget, GoalTarget.id == GoalTargetTask.goal_target_id)
        .join(Goal, Goal.id == GoalTarget.goal_id)
        .where(Goal.workspace_id == workspace_id, Goal.deleted_at.is_(None))
    ).all()
    return [
        {
            "task_id": task_id,
            "goal_id": goal_id,
            "goal_name": goal_name,
            "target_id": target_id,
            "target_title": target_title,
        }
        for task_id, goal_id, goal_name, target_id, target_title in rows
    ]


def link_tasks(
    db: Session,
    perms: PermissionService,
    target: GoalTarget,
    goal: Goal,
    task_ids: list[uuid.UUID],
    *,
    skip_conflicts: bool = False,
) -> int:
    if target.target_type != "tasks":
        raise HTTPException(status_code=422, detail="Only task-type targets can link tasks")
    existing_in_target = set(
        db.scalars(
            select(GoalTargetTask.task_id).where(GoalTargetTask.goal_target_id == target.id)
        ).all()
    )
    added = 0
    for task_id in dict.fromkeys(task_ids):
        if task_id in existing_in_target:
            continue
        task = db.get(Task, task_id)
        if not task or task.deleted_at is not None:
            if skip_conflicts:
                continue
            raise HTTPException(status_code=404, detail="Task not found")
        project = perms.get_project_or_404(task.project_id)
        if project.workspace_id != goal.workspace_id:
            if skip_conflicts:
                continue
            raise HTTPException(status_code=422, detail="Task must belong to the goal workspace")
        try:
            perms.require_task_view(task)
        except (PermissionError403, NotFound404, HTTPException):
            if skip_conflicts:
                continue
            raise
        conflict = existing_goal_for_task(db, task_id)
        if conflict:
            other_goal, other_target_id = conflict
            if other_target_id != target.id:
                if skip_conflicts:
                    continue
                raise HTTPException(
                    status_code=409,
                    detail=f"Task is already linked to goal {other_goal.name}",
                )
            continue
        link = GoalTargetTask(goal_target_id=target.id, task_id=task_id, added_by=perms.user.id)
        db.add(link)
        try:
            db.flush()
        except IntegrityError as exc:
            conflict = existing_goal_for_task(db, task_id)
            if conflict:
                raise HTTPException(
                    status_code=409,
                    detail=f"Task is already linked to goal {conflict[0].name}",
                ) from exc
            raise
        added += 1
        existing_in_target.add(task_id)
    if added:
        goal_progress_service.recalculate_target_progress(db, target.id)
        goal_progress_service.recalculate_goal_progress(db, goal.id)
    return added


def unlink_task(db: Session, target: GoalTarget, goal: Goal, task_id: uuid.UUID) -> None:
    link = db.scalar(
        select(GoalTargetTask).where(
            GoalTargetTask.goal_target_id == target.id,
            GoalTargetTask.task_id == task_id,
        )
    )
    if not link:
        raise HTTPException(status_code=404, detail="Task is not linked to this target")
    db.delete(link)
    db.flush()
    goal_progress_service.recalculate_target_progress(db, target.id)
    goal_progress_service.recalculate_goal_progress(db, goal.id)


def sprint_task_ids(db: Session, sprint_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(SprintTask.task_id)
            .join(Task, Task.id == SprintTask.task_id)
            .where(
                SprintTask.sprint_id == sprint_id,
                Task.deleted_at.is_(None),
            )
        ).all()
    )


def link_sprint(
    db: Session,
    perms: PermissionService,
    target: GoalTarget,
    goal: Goal,
    sprint_id: uuid.UUID,
) -> tuple[int, bool]:
    """Link a sprint (list) to a target and import its tasks. Returns (tasks_added, newly_linked)."""
    if target.target_type != "tasks":
        raise HTTPException(status_code=422, detail="Only task-type targets can link lists")
    sprint = db.get(Sprint, sprint_id)
    if not sprint or sprint.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Sprint not found")
    if sprint.workspace_id != goal.workspace_id:
        raise HTTPException(status_code=422, detail="Sprint must belong to the goal workspace")
    perms.require_workspace_member(sprint.workspace_id)

    existing = db.scalar(
        select(GoalTargetSprint).where(
            GoalTargetSprint.goal_target_id == target.id,
            GoalTargetSprint.sprint_id == sprint_id,
        )
    )
    newly_linked = existing is None
    if newly_linked:
        db.add(
            GoalTargetSprint(
                goal_target_id=target.id,
                sprint_id=sprint_id,
                added_by=perms.user.id,
            )
        )
        db.flush()

    task_ids = sprint_task_ids(db, sprint_id)
    added = link_tasks(db, perms, target, goal, task_ids, skip_conflicts=True) if task_ids else 0
    return added, newly_linked


def unlink_sprint(db: Session, target: GoalTarget, goal: Goal, sprint_id: uuid.UUID) -> None:
    link = db.scalar(
        select(GoalTargetSprint).where(
            GoalTargetSprint.goal_target_id == target.id,
            GoalTargetSprint.sprint_id == sprint_id,
        )
    )
    if not link:
        raise HTTPException(status_code=404, detail="Sprint is not linked to this target")
    db.delete(link)
    db.flush()


def list_linked_sprints(db: Session, target_id: uuid.UUID) -> list[Sprint]:
    return list(
        db.scalars(
            select(Sprint)
            .join(GoalTargetSprint, GoalTargetSprint.sprint_id == Sprint.id)
            .where(
                GoalTargetSprint.goal_target_id == target_id,
                Sprint.deleted_at.is_(None),
            )
            .order_by(Sprint.updated_at.desc())
        ).all()
    )


def sync_task_to_linked_sprint_targets(
    db: Session,
    perms: PermissionService | None,
    sprint_id: uuid.UUID,
    task_id: uuid.UUID,
) -> None:
    """When a task is added to a sprint, also link it to any goal targets that include that sprint."""
    target_ids = list(
        db.scalars(
            select(GoalTargetSprint.goal_target_id).where(GoalTargetSprint.sprint_id == sprint_id)
        ).all()
    )
    if not target_ids:
        return
    for target_id in target_ids:
        target = db.get(GoalTarget, target_id)
        if not target or target.target_type != "tasks":
            continue
        goal = db.get(Goal, target.goal_id)
        if not goal or goal.deleted_at is not None:
            continue
        if existing_goal_for_task(db, task_id):
            continue
        if perms is not None:
            link_tasks(db, perms, target, goal, [task_id], skip_conflicts=True)
            continue
        # Already conflict-checked above
        db.add(GoalTargetTask(goal_target_id=target.id, task_id=task_id))
        db.flush()
        goal_progress_service.recalculate_target_progress(db, target.id)
        goal_progress_service.recalculate_goal_progress(db, goal.id)
