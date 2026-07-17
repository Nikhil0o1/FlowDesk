"""Task follow / auto-follow for inbox notification settings."""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.task import Task, TaskFollower
from app.models.user import User
from app.services import email_service
from app.services.inbox_service import get_or_create_inbox_settings, user_email_notifications_enabled
from app.services.mention_service import excerpt
from app.services.notification_service import notify


def user_auto_follow_enabled(db: Session, user_id: uuid.UUID) -> bool:
    return get_or_create_inbox_settings(db, user_id).auto_follow_tasks


def follow_task(db: Session, task_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Add a follower row if missing. Returns True when a new row was created."""
    exists = db.scalar(
        select(TaskFollower.id).where(
            TaskFollower.task_id == task_id,
            TaskFollower.user_id == user_id,
        )
    )
    if exists:
        return False
    db.add(TaskFollower(task_id=task_id, user_id=user_id))
    db.flush()
    return True


def maybe_auto_follow(db: Session, user_id: uuid.UUID, task_id: uuid.UUID) -> None:
    """Follow a task when the user has auto-follow enabled in inbox settings."""
    if not user_auto_follow_enabled(db, user_id):
        return
    follow_task(db, task_id, user_id)


def follower_user_ids(db: Session, task_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(select(TaskFollower.user_id).where(TaskFollower.task_id == task_id)).all()
    )


def notify_followers_on_comment(
    db: Session,
    *,
    task: Task,
    project,
    author: User,
    body: str,
    comment_id: uuid.UUID,
    task_ref: str,
    url: str,
    exclude_user_ids: set[uuid.UUID],
) -> None:
    """Notify task followers about a new comment (top-level or reply)."""
    author_name = (
        author.profile.full_name if author.profile and author.profile.full_name else author.email
    )
    followers = follower_user_ids(db, task.id)
    for user_id in followers:
        if user_id in exclude_user_ids:
            continue
        user = db.get(User, user_id)
        if not user or not user.is_active:
            continue
        notify(
            db,
            user_id,
            "comment_reply",
            f"{author_name} commented on {task_ref}",
            excerpt(body),
            data={
                "task_id": str(task.id),
                "comment_id": str(comment_id),
                "url": url,
            },
            workspace_id=project.workspace_id,
            project_id=project.id,
        )
        if user_email_notifications_enabled(db, user_id):
            email_service.send_comment_reply_email(
                user.email, author_name, task_ref, excerpt(body), url
            )
