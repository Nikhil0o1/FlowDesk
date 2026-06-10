import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import Profile, User
from app.schemas.user import UserBrief


def user_brief(db: Session, user_id: uuid.UUID | None) -> UserBrief | None:
    if user_id is None:
        return None
    briefs = user_briefs(db, [user_id])
    return briefs.get(user_id)


def user_briefs(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, UserBrief]:
    """Batch-load brief user info (email, name, avatar) keyed by user id."""
    ids = [uid for uid in set(user_ids) if uid is not None]
    if not ids:
        return {}
    rows = db.execute(
        select(User.id, User.email, Profile.full_name, Profile.avatar_url, Profile.avatar_color)
        .outerjoin(Profile, Profile.user_id == User.id)
        .where(User.id.in_(ids))
    ).all()
    return {
        row.id: UserBrief(
            id=row.id,
            email=row.email,
            full_name=row.full_name or "",
            avatar_url=row.avatar_url,
            avatar_color=row.avatar_color,
        )
        for row in rows
    }
