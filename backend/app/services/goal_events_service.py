"""Goal / folder activity + notification helpers (Phase 5)."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.goal import Goal, GoalFolder, GoalTarget
from app.models.user import User
from app.services.activity_service import log_activity
from app.services.notification_service import notify


def actor_display_name(user: User) -> str:
    if user.profile and user.profile.full_name:
        return user.profile.full_name
    return user.email


def log_goal_activity(
    db: Session,
    *,
    goal: Goal,
    action: str,
    actor_id: uuid.UUID | None,
    extra: dict | None = None,
) -> None:
    data = {"goal_id": str(goal.id), "name": goal.name, "status": goal.status}
    if goal.folder_id:
        data["folder_id"] = str(goal.folder_id)
    if extra:
        data.update(extra)
    log_activity(
        db,
        workspace_id=goal.workspace_id,
        action=action,
        actor_id=actor_id,
        data=data,
    )


def log_folder_activity(
    db: Session,
    *,
    folder: GoalFolder,
    action: str,
    actor_id: uuid.UUID | None,
    extra: dict | None = None,
) -> None:
    data = {
        "folder_id": str(folder.id),
        "name": folder.name,
        "is_archived": folder.is_archived,
    }
    if extra:
        data.update(extra)
    log_activity(
        db,
        workspace_id=folder.workspace_id,
        action=action,
        actor_id=actor_id,
        data=data,
    )


def notify_goal_shared(
    db: Session,
    *,
    goal: Goal,
    user_id: uuid.UUID,
    actor_name: str,
) -> None:
    notify(
        db,
        user_id,
        "goal_shared",
        f"{actor_name} shared a goal with you",
        body=goal.name,
        data={"goal_id": str(goal.id), "url": f"/app/goals?goal={goal.id}"},
        workspace_id=goal.workspace_id,
    )


def notify_folder_shared(
    db: Session,
    *,
    folder: GoalFolder,
    user_id: uuid.UUID,
    actor_name: str,
) -> None:
    notify(
        db,
        user_id,
        "goal_folder_shared",
        f"{actor_name} shared a goal folder with you",
        body=folder.name,
        data={"folder_id": str(folder.id), "url": f"/app/goals?folder={folder.id}"},
        workspace_id=folder.workspace_id,
    )


def notify_goal_completed(
    db: Session,
    *,
    goal: Goal,
    user_id: uuid.UUID,
    actor_id: uuid.UUID | None = None,
) -> None:
    if actor_id is not None and user_id == actor_id:
        return
    notify(
        db,
        user_id,
        "goal_completed",
        "A goal was completed",
        body=goal.name,
        data={"goal_id": str(goal.id), "url": f"/app/goals?goal={goal.id}"},
        workspace_id=goal.workspace_id,
    )


def notify_goal_owner_assigned(
    db: Session,
    *,
    goal: Goal,
    owner_id: uuid.UUID,
    actor: User,
) -> None:
    """Inbox notification when someone is made goal owner (skips self-assign)."""
    if owner_id == actor.id:
        return
    actor_name = actor_display_name(actor)
    notify(
        db,
        owner_id,
        "goal_owner_assigned",
        f"{actor_name} assigned you as goal owner",
        body=goal.name,
        data={"goal_id": str(goal.id), "url": f"/app/goals?goal={goal.id}"},
        workspace_id=goal.workspace_id,
    )


def notify_target_owner_assigned(
    db: Session,
    *,
    goal: Goal,
    target: GoalTarget,
    owner_id: uuid.UUID,
    actor: User,
) -> None:
    """Inbox notification when someone is made target owner (skips self-assign)."""
    if owner_id == actor.id:
        return
    actor_name = actor_display_name(actor)
    notify(
        db,
        owner_id,
        "goal_target_owner_assigned",
        f"{actor_name} assigned you as target owner",
        body=f"{target.title} · {goal.name}",
        data={
            "goal_id": str(goal.id),
            "target_id": str(target.id),
            "url": f"/app/goals?goal={goal.id}",
        },
        workspace_id=goal.workspace_id,
    )
