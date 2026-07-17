"""Sprint facilitation helpers — changes and summary."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.task_ref import format_task_ref
from app.models.activity import ActivityLog
from app.models.sprint import Sprint, SprintRetrospective, SprintRetrospectiveItem, SprintTask, StandupUpdate
from app.models.task import Task
from app.schemas.sprint import (
    RetrospectiveItemOut,
    RetrospectiveOut,
    SprintChangeOut,
    SprintSummaryOut,
)
from app.services.user_service import user_briefs

SPRINT_CHANGE_ACTIONS = (
    "sprint.task_added",
    "sprint.task_removed",
    "sprint.task_moved",
    "sprint.started",
    "sprint.scope_lock_changed",
    "standup.blocker_resolved",
)


def format_sprint_change_summary(action: str, data: dict) -> str:
    if action == "sprint.task_added":
        ref = data.get("task_ref") or "Task"
        return f"Added {ref} to sprint"
    if action == "sprint.task_removed":
        ref = data.get("task_ref") or "Task"
        return f"Removed {ref} from sprint"
    if action == "sprint.task_moved":
        ref = data.get("task_ref") or "Task"
        return f"Moved {ref} to {data.get('to_sprint_name', 'another sprint')}"
    if action == "sprint.started":
        return "Sprint started"
    if action == "sprint.scope_lock_changed":
        locked = data.get("scope_locked")
        return "Scope locked after start" if locked else "Scope lock disabled"
    if action == "standup.blocker_resolved":
        return "Standup blocker marked resolved"
    return action.replace(".", " ").replace("_", " ")


def list_sprint_changes(db: Session, sprint_id: uuid.UUID, *, limit: int = 50) -> list[SprintChangeOut]:
    sid = str(sprint_id)
    rows = db.scalars(
        select(ActivityLog)
        .where(
            ActivityLog.action.in_(SPRINT_CHANGE_ACTIONS),
            or_(
                ActivityLog.data["sprint_id"].astext == sid,
                ActivityLog.data["from_sprint_id"].astext == sid,
                ActivityLog.data["to_sprint_id"].astext == sid,
            ),
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    ).all()
    briefs = user_briefs(db, [r.actor_id for r in rows if r.actor_id])
    return [
        SprintChangeOut(
            id=r.id,
            action=r.action,
            summary=format_sprint_change_summary(r.action, r.data or {}),
            actor=briefs.get(r.actor_id) if r.actor_id else None,
            data=r.data or {},
            created_at=r.created_at,
        )
        for r in rows
    ]


def build_sprint_summary(db: Session, sprint: Sprint) -> SprintSummaryOut:
    tasks = db.scalars(
        select(Task)
        .join(SprintTask, SprintTask.task_id == Task.id)
        .where(SprintTask.sprint_id == sprint.id, Task.deleted_at.is_(None))
    ).all()
    completed = [t for t in tasks if t.completed_at]
    incomplete = [t for t in tasks if not t.completed_at]
    total_pts = sum(t.story_points or 0 for t in tasks)
    done_pts = sum(t.story_points or 0 for t in completed)

    scope_changes = db.scalar(
        select(func.count())
        .select_from(ActivityLog)
        .where(
            ActivityLog.action.in_(
                ("sprint.task_added", "sprint.task_removed", "sprint.task_moved")
            ),
            or_(
                ActivityLog.data["sprint_id"].astext == str(sprint.id),
                ActivityLog.data["from_sprint_id"].astext == str(sprint.id),
            ),
        )
    ) or 0

    standup_rows = db.scalars(
        select(StandupUpdate).where(StandupUpdate.sprint_id == sprint.id)
    ).all()
    open_blockers = sum(
        1 for s in standup_rows if (s.blockers or "").strip() and not s.blocker_resolved_at
    )
    resolved_blockers = sum(1 for s in standup_rows if s.blocker_resolved_at)

    incomplete_refs: list[str] = []
    for t in incomplete[:20]:
        incomplete_refs.append(format_task_ref(t.project_id, t.number))

    pace = "on_track"
    if sprint.start_date and sprint.end_date and total_pts > 0:
        span = max((sprint.end_date - sprint.start_date).days, 1)
        elapsed = max((date.today() - sprint.start_date).days, 0)
        expected_done = total_pts * min(elapsed / span, 1)
        if done_pts >= expected_done * 1.05:
            pace = "ahead"
        elif done_pts < expected_done * 0.85:
            pace = "behind"

    return SprintSummaryOut(
        sprint_id=sprint.id,
        sprint_name=sprint.name,
        total_tasks=len(tasks),
        completed_tasks=len(completed),
        incomplete_tasks=len(incomplete),
        total_points=total_pts,
        completed_points=done_pts,
        scope_changes=scope_changes,
        open_blockers=open_blockers,
        resolved_blockers=resolved_blockers,
        incomplete_task_refs=incomplete_refs,
        pace=pace,
    )


def get_or_create_retrospective(db: Session, sprint: Sprint) -> SprintRetrospective:
    """Return the retrospective for a sprint, creating one if missing."""
    retro = db.scalar(
        select(SprintRetrospective).where(SprintRetrospective.sprint_id == sprint.id)
    )
    if retro:
        return retro
    retro = SprintRetrospective(sprint_id=sprint.id)
    db.add(retro)
    db.flush()
    return retro


def _item_out(item: SprintRetrospectiveItem, briefs: dict) -> RetrospectiveItemOut:
    out = RetrospectiveItemOut.model_validate(item)
    out.author = briefs.get(item.author_id)
    if item.assignee_id:
        out.assignee = briefs.get(item.assignee_id)
    return out


def build_retrospective_out(db: Session, sprint: Sprint, *, include_summary: bool = True) -> RetrospectiveOut:
    retro = get_or_create_retrospective(db, sprint)
    items = db.scalars(
        select(SprintRetrospectiveItem)
        .where(SprintRetrospectiveItem.retrospective_id == retro.id)
        .order_by(SprintRetrospectiveItem.created_at.asc())
    ).all()
    user_ids = [i.author_id for i in items] + [i.assignee_id for i in items if i.assignee_id]
    briefs = user_briefs(db, user_ids)
    out = RetrospectiveOut.model_validate(retro)
    out.items = [_item_out(i, briefs) for i in items]
    if include_summary:
        out.summary = build_sprint_summary(db, sprint)
    return out
