"""Goal CRUD helpers and response builders."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.goal import (
    Goal,
    GoalFolder,
    GoalFolderShareMember,
    GoalOwner,
    GoalShareMember,
    GoalTarget,
    GoalTargetOwner,
    GoalTargetTask,
    new_goal_share_token,
)
from app.models.workspace import WorkspaceMember
from app.schemas.goal import (
    GoalDetailOut,
    GoalFolderAnalyticsOut,
    GoalFolderDetailOut,
    GoalFolderOut,
    GoalFolderShareMemberOut,
    GoalFolderShareState,
    GoalOut,
    GoalProgressOut,
    GoalShareMemberOut,
    GoalShareState,
    GoalTargetOut,
    GoalTargetProgressOut,
)
from app.services import goal_progress_service
from app.services.user_service import user_briefs


def get_goal_or_404(db: Session, goal_id: uuid.UUID) -> Goal:
    goal = db.get(Goal, goal_id)
    if not goal or goal.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


def get_target_or_404(db: Session, target_id: uuid.UUID) -> GoalTarget:
    target = db.get(GoalTarget, target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    return target


def validate_goal_dates(
    start_date: date | None,
    due_date: date | None,
    *,
    existing_start: date | None = None,
    existing_due: date | None = None,
) -> None:
    today = date.today()
    if start_date is not None and start_date < today and start_date != existing_start:
        raise HTTPException(status_code=422, detail="Start date cannot be in the past")
    if due_date is not None and due_date < today and due_date != existing_due:
        raise HTTPException(status_code=422, detail="Due date cannot be in the past")
    if start_date and due_date and due_date < start_date:
        raise HTTPException(status_code=422, detail="Due date must be on or after start date")


def assert_owner_is_workspace_member(db: Session, workspace_id: uuid.UUID, owner_id: uuid.UUID) -> None:
    member = db.scalar(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == owner_id,
        )
    )
    if not member:
        raise HTTPException(status_code=422, detail="Owner must be a workspace member")


def assert_owners_are_workspace_members(
    db: Session, workspace_id: uuid.UUID, owner_ids: list[uuid.UUID]
) -> None:
    for oid in owner_ids:
        assert_owner_is_workspace_member(db, workspace_id, oid)


def goal_owner_ids(db: Session, goal_id: uuid.UUID) -> list[uuid.UUID]:
    rows = db.scalars(select(GoalOwner.user_id).where(GoalOwner.goal_id == goal_id)).all()
    return list(rows)


def target_owner_ids(db: Session, target_id: uuid.UUID) -> list[uuid.UUID]:
    rows = db.scalars(select(GoalTargetOwner.user_id).where(GoalTargetOwner.goal_target_id == target_id)).all()
    return list(rows)


def set_goal_owners(
    db: Session,
    goal: Goal,
    owner_ids: list[uuid.UUID],
    *,
    created_by: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Replace goal co-owners. First id becomes primary owner_id. Returns previous owner ids."""
    if not owner_ids:
        raise HTTPException(status_code=422, detail="At least one owner is required")
    assert_owners_are_workspace_members(db, goal.workspace_id, owner_ids)
    prev = set(goal_owner_ids(db, goal.id))
    if not prev and goal.owner_id:
        prev.add(goal.owner_id)
    db.execute(delete(GoalOwner).where(GoalOwner.goal_id == goal.id))
    for uid in owner_ids:
        db.add(GoalOwner(goal_id=goal.id, user_id=uid, created_by=created_by))
    goal.owner_id = owner_ids[0]
    db.flush()
    return list(prev)


def set_target_owners(
    db: Session,
    goal: Goal,
    target: GoalTarget,
    owner_ids: list[uuid.UUID],
    *,
    created_by: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    if not owner_ids:
        raise HTTPException(status_code=422, detail="At least one owner is required")
    assert_owners_are_workspace_members(db, goal.workspace_id, owner_ids)
    prev = set(target_owner_ids(db, target.id))
    if not prev and target.owner_id:
        prev.add(target.owner_id)
    db.execute(delete(GoalTargetOwner).where(GoalTargetOwner.goal_target_id == target.id))
    for uid in owner_ids:
        db.add(GoalTargetOwner(goal_target_id=target.id, user_id=uid, created_by=created_by))
    target.owner_id = owner_ids[0]
    db.flush()
    return list(prev)


def _ordered_owner_briefs(
    briefs: dict,
    primary_id: uuid.UUID | None,
    owner_ids: list[uuid.UUID],
) -> list:
    ordered: list = []
    seen: set[uuid.UUID] = set()
    if primary_id and primary_id in briefs:
        ordered.append(briefs[primary_id])
        seen.add(primary_id)
    for uid in owner_ids:
        if uid in seen or uid not in briefs:
            continue
        ordered.append(briefs[uid])
        seen.add(uid)
    return ordered


def assert_folder_in_workspace(
    db: Session, workspace_id: uuid.UUID, folder_id: uuid.UUID | None
) -> GoalFolder | None:
    if folder_id is None:
        return None
    folder = db.get(GoalFolder, folder_id)
    if not folder or folder.workspace_id != workspace_id:
        raise HTTPException(status_code=422, detail="Folder not found in this workspace")
    return folder


def get_folder_or_404(db: Session, folder_id: uuid.UUID) -> GoalFolder:
    folder = db.get(GoalFolder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


def _empty_folder_stats() -> dict:
    return {
        "goal_count": 0,
        "progress": Decimal("0"),
        "active_count": 0,
        "completed_count": 0,
        "archived_count": 0,
        "draft_count": 0,
        "tracked_goal_count": 0,
        "not_started_count": 0,
        "in_progress_count": 0,
        "at_risk_count": 0,
    }


def _folder_goal_stats(db: Session, folder_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Aggregate goal counts and progress for folders (Phase 4 analytics)."""
    if not folder_ids:
        return {}
    goals = db.scalars(
        select(Goal).where(
            Goal.folder_id.in_(folder_ids),
            Goal.deleted_at.is_(None),
        )
    ).all()
    out: dict[uuid.UUID, dict] = {fid: _empty_folder_stats() for fid in folder_ids}
    today = date.today()
    tracked_progress: dict[uuid.UUID, list[Decimal]] = {fid: [] for fid in folder_ids}

    for goal in goals:
        if goal.folder_id is None:
            continue
        stats = out.setdefault(goal.folder_id, _empty_folder_stats())
        tracked = tracked_progress.setdefault(goal.folder_id, [])
        stats["goal_count"] += 1
        if goal.status == "active":
            stats["active_count"] += 1
        elif goal.status == "completed":
            stats["completed_count"] += 1
        elif goal.status == "archived":
            stats["archived_count"] += 1
        elif goal.status == "draft":
            stats["draft_count"] += 1

        if goal.status != "archived":
            tracked.append(goal.progress)
            stats["tracked_goal_count"] += 1
            pct = float(goal.progress)
            if pct <= 0:
                stats["not_started_count"] += 1
            elif pct < 100:
                stats["in_progress_count"] += 1
            if (
                goal.status == "active"
                and goal.due_date is not None
                and goal.due_date < today
                and pct < 100
            ):
                stats["at_risk_count"] += 1

    for folder_id, values in tracked_progress.items():
        if not values:
            continue
        avg = sum(float(v) for v in values) / len(values)
        out[folder_id]["progress"] = Decimal(str(avg)).quantize(Decimal("0.01"))
    return out


def folder_out(db: Session, folder: GoalFolder, *, stats: dict | None = None) -> GoalFolderOut:
    if stats is None:
        stats = _folder_goal_stats(db, [folder.id]).get(folder.id, _empty_folder_stats())
    briefs = user_briefs(db, [folder.created_by] if folder.created_by else [])
    return GoalFolderOut(
        id=folder.id,
        workspace_id=folder.workspace_id,
        name=folder.name,
        description=folder.description,
        color=folder.color,
        is_private=folder.is_private,
        is_archived=folder.is_archived,
        archived_at=folder.archived_at,
        created_by=folder.created_by,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        goal_count=stats["goal_count"],
        progress=stats["progress"],
        active_count=stats["active_count"],
        completed_count=stats["completed_count"],
        archived_count=stats["archived_count"],
        draft_count=stats["draft_count"],
        created_by_user=briefs.get(folder.created_by) if folder.created_by else None,
    )


def folder_analytics_out(db: Session, folder: GoalFolder) -> GoalFolderAnalyticsOut:
    stats = _folder_goal_stats(db, [folder.id]).get(folder.id, _empty_folder_stats())
    return GoalFolderAnalyticsOut(
        folder_id=folder.id,
        name=folder.name,
        progress=stats["progress"],
        goal_count=stats["goal_count"],
        active_count=stats["active_count"],
        completed_count=stats["completed_count"],
        archived_count=stats["archived_count"],
        draft_count=stats["draft_count"],
        tracked_goal_count=stats["tracked_goal_count"],
        not_started_count=stats["not_started_count"],
        in_progress_count=stats["in_progress_count"],
        at_risk_count=stats["at_risk_count"],
    )


def list_folders(
    db: Session,
    workspace_id: uuid.UUID,
    *,
    include_archived: bool = False,
) -> list[GoalFolderOut]:
    query = select(GoalFolder).where(GoalFolder.workspace_id == workspace_id)
    if not include_archived:
        query = query.where(GoalFolder.is_archived.is_(False))
    rows = db.scalars(query.order_by(GoalFolder.updated_at.desc())).all()
    stats = _folder_goal_stats(db, [f.id for f in rows])
    return [
        folder_out(db, folder, stats=stats.get(folder.id, _empty_folder_stats()))
        for folder in rows
    ]


def create_folder(
    db: Session,
    workspace_id: uuid.UUID,
    *,
    name: str,
    description: str | None,
    color: str | None,
    created_by: uuid.UUID,
    is_private: bool = False,
) -> GoalFolder:
    folder = GoalFolder(
        workspace_id=workspace_id,
        name=name.strip(),
        description=(description or "").strip() or None,
        color=color,
        is_private=is_private,
        created_by=created_by,
    )
    db.add(folder)
    db.flush()
    return folder


def update_folder(folder: GoalFolder, changes: dict) -> GoalFolder:
    if "name" in changes and changes["name"] is not None:
        folder.name = str(changes["name"]).strip()
    if "description" in changes:
        desc = changes["description"]
        folder.description = (str(desc).strip() or None) if desc is not None else None
    if "color" in changes:
        folder.color = changes["color"]
    if "is_private" in changes and changes["is_private"] is not None:
        folder.is_private = bool(changes["is_private"])
    if "is_archived" in changes and changes["is_archived"] is not None:
        folder.is_archived = bool(changes["is_archived"])
        from datetime import datetime, timezone

        folder.archived_at = datetime.now(timezone.utc) if folder.is_archived else None
    return folder


def delete_folder(db: Session, folder: GoalFolder) -> None:
    db.delete(folder)


def folder_share_state(db: Session, folder: GoalFolder) -> GoalFolderShareState:
    members = db.scalars(
        select(GoalFolderShareMember).where(GoalFolderShareMember.folder_id == folder.id)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    return GoalFolderShareState(
        folder_id=folder.id,
        is_private=folder.is_private,
        members=[
            GoalFolderShareMemberOut(user_id=m.user_id, role=m.role, user=briefs.get(m.user_id))
            for m in members
        ],
    )


def folder_detail_out(db: Session, folder: GoalFolder, goals: list[Goal]) -> GoalFolderDetailOut:
    base = folder_out(db, folder)
    return GoalFolderDetailOut(
        **base.model_dump(),
        goals=[goal_out(db, g) for g in goals],
    )


def goals_in_folder_query(folder_id: uuid.UUID):
    return select(Goal).where(Goal.folder_id == folder_id, Goal.deleted_at.is_(None))


def next_goal_display_order(
    db: Session, workspace_id: uuid.UUID, folder_id: uuid.UUID | None
) -> int:
    q = select(func.coalesce(func.max(Goal.display_order), -1)).where(
        Goal.workspace_id == workspace_id,
        Goal.deleted_at.is_(None),
    )
    if folder_id is None:
        q = q.where(Goal.folder_id.is_(None))
    else:
        q = q.where(Goal.folder_id == folder_id)
    current = db.scalar(q)
    return int(current) + 1


def reorder_goals(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    goal_ids: list[uuid.UUID],
    folder_id: uuid.UUID | None = None,
) -> None:
    if not goal_ids:
        return
    if folder_id is not None:
        assert_folder_in_workspace(db, workspace_id, folder_id)
    goals = db.scalars(
        select(Goal).where(
            Goal.workspace_id == workspace_id,
            Goal.deleted_at.is_(None),
            Goal.id.in_(goal_ids),
        )
    ).all()
    by_id = {g.id: g for g in goals}
    if len(by_id) != len(set(goal_ids)):
        raise HTTPException(status_code=422, detail="One or more goals were not found")
    for goal_id in goal_ids:
        goal = by_id[goal_id]
        if folder_id is None:
            if goal.folder_id is not None:
                raise HTTPException(status_code=422, detail="Goal is not in the root list")
        elif goal.folder_id != folder_id:
            raise HTTPException(status_code=422, detail="Goal is not in this folder")
    for index, goal_id in enumerate(goal_ids):
        by_id[goal_id].display_order = index
    db.flush()


def move_goal_to_folder(db: Session, goal: Goal, folder_id: uuid.UUID | None) -> Goal:
    if folder_id is not None:
        assert_folder_in_workspace(db, goal.workspace_id, folder_id)
    goal.folder_id = folder_id
    goal.display_order = next_goal_display_order(db, goal.workspace_id, folder_id)
    return goal


def create_goal_record(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    body,
    created_by: uuid.UUID,
    folder_id: uuid.UUID | None = None,
) -> Goal:
    validate_goal_dates(body.start_date, body.due_date)
    owner_ids = list(getattr(body, "owner_ids", None) or [body.owner_id])
    assert_owners_are_workspace_members(db, workspace_id, owner_ids)
    resolved_folder = folder_id if folder_id is not None else getattr(body, "folder_id", None)
    if resolved_folder is not None:
        assert_folder_in_workspace(db, workspace_id, resolved_folder)
    goal = Goal(
        workspace_id=workspace_id,
        name=body.name,
        description=body.description,
        owner_id=owner_ids[0],
        status=body.status,
        start_date=body.start_date,
        due_date=body.due_date,
        is_private=body.is_private,
        color=body.color,
        folder_id=resolved_folder,
        display_order=next_goal_display_order(db, workspace_id, resolved_folder),
        created_by=created_by,
    )
    ensure_share_token(goal)
    db.add(goal)
    db.flush()
    set_goal_owners(db, goal, owner_ids, created_by=created_by)
    return goal


def ensure_share_token(goal: Goal) -> str:
    if not goal.share_token:
        goal.share_token = new_goal_share_token()
    return goal.share_token


def next_target_display_order(db: Session, goal_id: uuid.UUID) -> int:
    current = db.scalar(
        select(func.coalesce(func.max(GoalTarget.display_order), -1)).where(GoalTarget.goal_id == goal_id)
    )
    return int(current) + 1


def create_target_from_body(db: Session, goal: Goal, body) -> GoalTarget:
    owner_ids = list(getattr(body, "owner_ids", None) or [body.owner_id])
    assert_owners_are_workspace_members(db, goal.workspace_id, owner_ids)

    target = GoalTarget(
        goal_id=goal.id,
        title=body.title,
        owner_id=owner_ids[0],
        target_type=body.target_type,
        display_order=next_target_display_order(db, goal.id),
        is_completed=bool(body.is_completed) if body.target_type == "true_false" else False,
    )
    if body.target_type in ("number", "currency"):
        target.start_value = body.start_value if body.start_value is not None else Decimal("0")
        target.target_value = body.target_value if body.target_value is not None else Decimal("1")
        target.current_value = body.current_value if body.current_value is not None else target.start_value
    db.add(target)
    db.flush()
    set_target_owners(db, goal, target, owner_ids)
    goal_progress_service.recalculate_target_progress(db, target.id)
    goal_progress_service.recalculate_goal_progress(db, goal.id)
    return target


def _target_task_counts(db: Session, target_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not target_ids:
        return {}
    rows = db.execute(
        select(GoalTargetTask.goal_target_id, func.count())
        .where(GoalTargetTask.goal_target_id.in_(target_ids))
        .group_by(GoalTargetTask.goal_target_id)
    ).all()
    return {row[0]: int(row[1]) for row in rows}


def _goal_target_counts(db: Session, goal_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not goal_ids:
        return {}
    rows = db.execute(
        select(GoalTarget.goal_id, func.count())
        .where(GoalTarget.goal_id.in_(goal_ids))
        .group_by(GoalTarget.goal_id)
    ).all()
    return {row[0]: int(row[1]) for row in rows}


def goal_out(db: Session, goal: Goal) -> GoalOut:
    out = GoalOut.model_validate(goal)
    counts = _goal_target_counts(db, [goal.id])
    out.target_count = counts.get(goal.id, 0)
    co_owner_ids = goal_owner_ids(db, goal.id)
    user_ids = list({*(co_owner_ids or []), goal.owner_id, *( [goal.created_by] if goal.created_by else [])})
    briefs = user_briefs(db, user_ids)
    out.owner = briefs.get(goal.owner_id)
    out.owners = _ordered_owner_briefs(briefs, goal.owner_id, co_owner_ids or [goal.owner_id])
    if goal.created_by:
        out.created_by_user = briefs.get(goal.created_by)
    return out


def _target_out_from_model(
    target: GoalTarget,
    task_count: int,
    owner_brief=None,
    owners: list | None = None,
) -> GoalTargetOut:
    return GoalTargetOut(
        id=target.id,
        goal_id=target.goal_id,
        title=target.title,
        owner_id=target.owner_id,
        target_type=target.target_type,
        start_value=target.start_value,
        target_value=target.target_value,
        current_value=target.current_value,
        is_completed=target.is_completed,
        progress=target.progress,
        display_order=target.display_order,
        created_at=target.created_at,
        updated_at=target.updated_at,
        linked_task_count=task_count,
        owner=owner_brief,
        owners=owners or ([owner_brief] if owner_brief else []),
    )


def goal_detail_out(db: Session, goal: Goal) -> GoalDetailOut:
    base = goal_out(db, goal)
    targets = db.scalars(
        select(GoalTarget)
        .where(GoalTarget.goal_id == goal.id)
        .order_by(GoalTarget.display_order.asc(), GoalTarget.created_at.asc())
    ).all()
    task_counts = _target_task_counts(db, [t.id for t in targets])
    all_owner_ids: list[uuid.UUID] = []
    target_owners_map: dict[uuid.UUID, list[uuid.UUID]] = {}
    for t in targets:
        oids = target_owner_ids(db, t.id)
        if not oids and t.owner_id:
            oids = [t.owner_id]
        target_owners_map[t.id] = oids
        all_owner_ids.extend(oids)
    briefs = user_briefs(db, all_owner_ids)
    target_rows = []
    for t in targets:
        oids = target_owners_map[t.id]
        owners = _ordered_owner_briefs(briefs, t.owner_id, oids)
        primary = briefs.get(t.owner_id) if t.owner_id else (owners[0] if owners else None)
        target_rows.append(
            _target_out_from_model(t, task_counts.get(t.id, 0), primary, owners)
        )
    return GoalDetailOut(**base.model_dump(), targets=target_rows)


def target_out(db: Session, target: GoalTarget) -> GoalTargetOut:
    counts = _target_task_counts(db, [target.id])
    oids = target_owner_ids(db, target.id)
    if not oids and target.owner_id:
        oids = [target.owner_id]
    briefs = user_briefs(db, oids)
    owners = _ordered_owner_briefs(briefs, target.owner_id, oids)
    primary = briefs.get(target.owner_id) if target.owner_id else (owners[0] if owners else None)
    return _target_out_from_model(target, counts.get(target.id, 0), primary, owners)


def goal_progress_out(db: Session, goal: Goal) -> GoalProgressOut:
    targets = db.scalars(
        select(GoalTarget)
        .where(GoalTarget.goal_id == goal.id)
        .order_by(GoalTarget.display_order.asc(), GoalTarget.created_at.asc())
    ).all()
    task_counts = _target_task_counts(db, [t.id for t in targets])
    return GoalProgressOut(
        goal_id=goal.id,
        progress=goal.progress,
        targets=[
            GoalTargetProgressOut(
                id=t.id,
                title=t.title,
                progress=t.progress,
                target_type=t.target_type,
                linked_task_count=task_counts.get(t.id, 0),
            )
            for t in targets
        ],
    )


def share_state(db: Session, goal: Goal) -> GoalShareState:
    ensure_share_token(goal)
    members = db.scalars(select(GoalShareMember).where(GoalShareMember.goal_id == goal.id)).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    frontend = settings.FRONTEND_URL.rstrip("/")
    return GoalShareState(
        goal_id=goal.id,
        is_private=goal.is_private,
        share_token=goal.share_token,
        share_url=f"{frontend}/app/goals?goal={goal.id}",
        workspace_shared=not goal.is_private,
        members=[
            GoalShareMemberOut(user_id=m.user_id, role=m.role, user=briefs.get(m.user_id))
            for m in members
        ],
    )


def remove_goal_targets(db: Session, goal_id: uuid.UUID) -> None:
    """Hard-delete targets and task links so tasks can be reused elsewhere."""
    db.execute(delete(GoalTarget).where(GoalTarget.goal_id == goal_id))
