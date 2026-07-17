"""Goal target and goal progress recalculation."""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.websocket import emit
from app.models.goal import Goal, GoalTarget, GoalTargetTask
from app.models.task import CustomStatus, Task


def _quantize_progress(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _numeric_progress(start: Decimal, target: Decimal, current: Decimal) -> Decimal:
    span = target - start
    if span == 0:
        return Decimal("100.00") if current == target else Decimal("0")
    # Support decreasing targets (start 10 → target 0)
    ratio = (current - start) / span
    pct = float(ratio) * 100
    return _quantize_progress(max(0.0, min(100.0, pct)))


def recalculate_target_progress(db: Session, target_id: uuid.UUID) -> Decimal:
    target = db.get(GoalTarget, target_id)
    if not target:
        return Decimal("0")

    if target.target_type == "true_false":
        target.progress = Decimal("100.00") if target.is_completed else Decimal("0")
        return target.progress

    if target.target_type in ("number", "currency"):
        start = target.start_value if target.start_value is not None else Decimal("0")
        end = target.target_value if target.target_value is not None else Decimal("1")
        current = target.current_value if target.current_value is not None else start
        target.progress = _numeric_progress(start, end, current)
        return target.progress

    # tasks (default)
    rows = db.execute(
        select(CustomStatus.category)
        .select_from(GoalTargetTask)
        .join(Task, Task.id == GoalTargetTask.task_id)
        .outerjoin(CustomStatus, CustomStatus.id == Task.status_id)
        .where(GoalTargetTask.goal_target_id == target_id, Task.deleted_at.is_(None))
    ).all()
    if not rows:
        target.progress = Decimal("0")
        return target.progress
    done = sum(1 for (category,) in rows if category == "done")
    target.progress = _quantize_progress(done * 100 / len(rows))
    return target.progress


def recalculate_goal_progress(db: Session, goal_id: uuid.UUID) -> Goal | None:
    goal = db.get(Goal, goal_id)
    if not goal or goal.deleted_at is not None:
        return None
    targets = db.scalars(select(GoalTarget).where(GoalTarget.goal_id == goal_id)).all()
    if not targets:
        goal.progress = Decimal("0")
    else:
        total = sum(float(t.progress) for t in targets)
        goal.progress = _quantize_progress(total / len(targets))
    if goal.progress >= Decimal("100.00") and goal.status == "active":
        goal.status = "completed"
    elif goal.progress < Decimal("100.00") and goal.status == "completed":
        goal.status = "active"
    return goal


def recalculate_goal_chain(db: Session, goal_id: uuid.UUID) -> Goal | None:
    targets = db.scalars(select(GoalTarget).where(GoalTarget.goal_id == goal_id)).all()
    for target in targets:
        recalculate_target_progress(db, target.id)
    return recalculate_goal_progress(db, goal_id)


def on_task_changed(db: Session, task_id: uuid.UUID) -> list[Goal]:
    """Recalculate every goal affected by a linked task change."""
    db.flush()
    target_ids = db.scalars(
        select(GoalTargetTask.goal_target_id).where(GoalTargetTask.task_id == task_id)
    ).all()
    if not target_ids:
        return []
    goal_ids: set[uuid.UUID] = set()
    for target_id in target_ids:
        target = db.get(GoalTarget, target_id)
        if not target or target.target_type != "tasks":
            continue
        recalculate_target_progress(db, target_id)
        goal_ids.add(target.goal_id)
    updated: list[Goal] = []
    for goal_id in goal_ids:
        goal = recalculate_goal_progress(db, goal_id)
        if goal:
            updated.append(goal)
    return updated


def emit_goal_updated(goal: Goal, *, extra: dict | None = None) -> None:
    emit(
        "goal.updated",
        [f"workspace:{goal.workspace_id}"],
        payload={
            "goal_id": str(goal.id),
            "progress": str(goal.progress),
            "status": goal.status,
            **(extra or {}),
        },
        workspace_id=goal.workspace_id,
        goal_id=goal.id,
    )


def emit_goals_updated(goals: list[Goal]) -> None:
    seen: set[uuid.UUID] = set()
    for goal in goals:
        if goal.id in seen:
            continue
        seen.add(goal.id)
        emit_goal_updated(goal)


def goals_for_task(db: Session, task_id: uuid.UUID) -> list[Goal]:
    goal_ids = db.scalars(
        select(GoalTarget.goal_id)
        .join(GoalTargetTask, GoalTargetTask.goal_target_id == GoalTarget.id)
        .join(Goal, Goal.id == GoalTarget.goal_id)
        .where(GoalTargetTask.task_id == task_id, Goal.deleted_at.is_(None))
    ).all()
    if not goal_ids:
        return []
    return list(db.scalars(select(Goal).where(Goal.id.in_(goal_ids))).all())
