import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import Select, func, or_, select, update
from sqlalchemy.orm import Session

from app.models.inbox import InboxSettings, NotificationTypePreference
from app.models.notification import (
    DEFAULT_IMPORTANT_TYPES,
    NOTIFICATION_DISPLAY_ORDER,
    NOTIFICATION_TYPE_LABELS,
    NOTIFICATION_TYPES,
    Notification,
)
from app.schemas.notification import CLEARED_RETENTION_DAYS, NotificationOutExtended


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _catalog_types() -> list[str]:
    known = set(NOTIFICATION_TYPES)
    ordered = [t for t in NOTIFICATION_DISPLAY_ORDER if t in known]
    for t in sorted(known):
        if t not in ordered:
            ordered.append(t)
    return ordered


def get_or_create_inbox_settings(db: Session, user_id: uuid.UUID) -> InboxSettings:
    settings = db.get(InboxSettings, user_id)
    if settings:
        return settings
    settings = InboxSettings(user_id=user_id)
    db.add(settings)
    db.flush()
    return settings


def user_email_notifications_enabled(db: Session, user_id: uuid.UUID) -> bool:
    return get_or_create_inbox_settings(db, user_id).email_notifications_enabled


def get_type_importance_map(db: Session, user_id: uuid.UUID) -> dict[str, bool]:
    rows = db.scalars(
        select(NotificationTypePreference).where(NotificationTypePreference.user_id == user_id)
    ).all()
    overrides = {row.type: row.important for row in rows}
    return {ntype: overrides.get(ntype, ntype in DEFAULT_IMPORTANT_TYPES) for ntype in _catalog_types()}


def is_important(db: Session, user_id: uuid.UUID, ntype: str) -> bool:
    return get_type_importance_map(db, user_id).get(ntype, ntype in DEFAULT_IMPORTANT_TYPES)


def notification_preferences_payload(db: Session, user_id: uuid.UUID) -> tuple[list[dict], int, int]:
    """Return one row per notification type FlowDesk can emit."""
    importance = get_type_importance_map(db, user_id)
    items: list[dict] = []
    important_count = 0
    for ntype in _catalog_types():
        if ntype not in NOTIFICATION_TYPE_LABELS:
            continue
        flag = importance[ntype]
        if flag:
            important_count += 1
        items.append({
            "type": ntype,
            "label": NOTIFICATION_TYPE_LABELS[ntype],
            "important": flag,
            "section": "important" if flag else "not_important",
        })
    return items, important_count, len(items)


def set_type_preference(db: Session, user_id: uuid.UUID, ntype: str, important: bool) -> None:
    if ntype not in NOTIFICATION_TYPE_LABELS:
        raise ValueError(f"Unknown notification type: {ntype}")
    row = db.scalar(
        select(NotificationTypePreference).where(
            NotificationTypePreference.user_id == user_id,
            NotificationTypePreference.type == ntype,
        )
    )
    if row:
        row.important = important
    else:
        db.add(NotificationTypePreference(user_id=user_id, type=ntype, important=important))


def reset_type_preferences(db: Session, user_id: uuid.UUID) -> None:
    db.query(NotificationTypePreference).filter(
        NotificationTypePreference.user_id == user_id
    ).delete(synchronize_session=False)


def _active_base(user_id: uuid.UUID) -> Select:
    cutoff = _now() - timedelta(days=CLEARED_RETENTION_DAYS)
    return (
        select(Notification)
        .where(Notification.user_id == user_id)
        .where(or_(Notification.cleared_at.is_(None), Notification.cleared_at > cutoff))
    )


def _apply_inbox_tab(stmt: Select, *, db: Session, user_id: uuid.UUID, tab: str) -> Select:
    """Route notifications into Primary / Other / Later / Cleared / All (ClickUp-style)."""
    now = _now()
    importance = get_type_importance_map(db, user_id)

    if tab == "cleared":
        return stmt.where(Notification.cleared_at.is_not(None))

    stmt = stmt.where(Notification.cleared_at.is_(None))

    if tab == "later":
        return stmt.where(Notification.snoozed_until.is_not(None), Notification.snoozed_until > now)

    # Active (non-snoozed) buckets — snoozed items live only in Later until they wake up.
    stmt = stmt.where(or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= now))

    if tab == "primary":
        important_types = [t for t, v in importance.items() if v]
        if not important_types:
            return stmt.where(False)
        return stmt.where(Notification.type.in_(important_types))

    if tab == "other":
        not_important_types = [t for t, v in importance.items() if not v]
        if not_important_types:
            return stmt.where(Notification.type.in_(not_important_types))
        return stmt.where(False)

    # tab == "all" — every active, non-cleared, non-snoozed inbox notification
    return stmt


def apply_inbox_filters(
    stmt: Select,
    *,
    db: Session,
    user_id: uuid.UUID,
    tab: str | None = None,
    view: str | None = None,
    filter_kind: str | None = None,
    search: str | None = None,
    unread_only: bool = False,
    read_only: bool = False,
) -> Select:
    effective_view = view or "inbox"

    if effective_view == "replies":
        stmt = stmt.where(Notification.type == "comment_reply")
        stmt = stmt.where(Notification.cleared_at.is_(None))
        stmt = stmt.where(
            or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= _now())
        )
    elif effective_view == "assigned_comments":
        stmt = stmt.where(Notification.type == "comment_mention")
        stmt = stmt.where(Notification.cleared_at.is_(None))
        stmt = stmt.where(
            or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= _now())
        )
    else:
        # Inbox — thread replies live in the Replies view, not here.
        stmt = stmt.where(Notification.type != "comment_reply")
        if tab:
            stmt = _apply_inbox_tab(stmt, db=db, user_id=user_id, tab=tab)
        else:
            stmt = stmt.where(Notification.cleared_at.is_(None))
            stmt = stmt.where(
                or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= _now())
            )

    if filter_kind == "mentions":
        stmt = stmt.where(
            Notification.type.in_(("comment_mention", "chat_mention", "doc_mention"))
        )
    elif filter_kind == "assigned":
        stmt = stmt.where(Notification.type == "task_assigned")
    elif filter_kind == "unread":
        stmt = stmt.where(Notification.read_at.is_(None))
    elif filter_kind == "reminders":
        stmt = stmt.where(Notification.type.in_(("due_date_reminder", "task_overdue")))

    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))

    if read_only:
        stmt = stmt.where(Notification.read_at.is_not(None))

    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(Notification.title.ilike(like), Notification.body.ilike(like)))

    return stmt


def to_notification_out(n: Notification, important: bool) -> NotificationOutExtended:
    return NotificationOutExtended(
        id=n.id,
        type=n.type,
        title=n.title,
        body=n.body,
        data=n.data,
        read_at=n.read_at,
        snoozed_until=n.snoozed_until,
        cleared_at=n.cleared_at,
        workspace_id=n.workspace_id,
        project_id=n.project_id,
        created_at=n.created_at,
        important=important,
    )


def list_notifications(
    db: Session,
    user_id: uuid.UUID,
    *,
    tab: str | None = None,
    view: str | None = None,
    filter_kind: str | None = None,
    search: str | None = None,
    unread_only: bool = False,
    read_only: bool = False,
    page: int = 1,
    page_size: int = 30,
    sort_newest_first: bool = True,
) -> tuple[list[NotificationOutExtended], int]:
    base = _active_base(user_id)
    # Only apply Primary/Other/Later/Cleared when the caller asks for a tab.
    # Unscoped lists (dropdown, unread_only, smoke tests) return all active inbox items.
    base = apply_inbox_filters(
        base,
        db=db,
        user_id=user_id,
        tab=tab,
        view=view,
        filter_kind=filter_kind,
        search=search,
        unread_only=unread_only,
        read_only=read_only,
    )
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    order = Notification.created_at.desc() if sort_newest_first else Notification.created_at.asc()
    rows = db.scalars(base.order_by(order).offset((page - 1) * page_size).limit(page_size)).all()
    importance = get_type_importance_map(db, user_id)
    items = [to_notification_out(n, importance.get(n.type, n.type in DEFAULT_IMPORTANT_TYPES)) for n in rows]
    return items, total


def inbox_summary(db: Session, user_id: uuid.UUID, *, tab: str | None = None, view: str | None = None) -> dict[str, int]:
    def _count(filter_kind: str | None = None, unread: bool = False) -> int:
        stmt = _active_base(user_id)
        stmt = apply_inbox_filters(
            stmt, db=db, user_id=user_id, tab=tab, view=view, filter_kind=filter_kind, unread_only=unread
        )
        return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    return {
        "mentions": _count("mentions"),
        "assigned_to_me": _count("assigned"),
        "unread": _count(unread=True),
        "reminders": _count("reminders"),
    }


def unread_replies_count(db: Session, user_id: uuid.UUID) -> int:
    now = _now()
    stmt = (
        select(func.count(Notification.id))
        .where(Notification.user_id == user_id)
        .where(Notification.type == "comment_reply")
        .where(Notification.read_at.is_(None))
        .where(Notification.cleared_at.is_(None))
        .where(or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= now))
    )
    return db.scalar(stmt) or 0


def unread_inbox_count(db: Session, user_id: uuid.UUID) -> int:
    now = _now()
    stmt = (
        select(func.count(Notification.id))
        .where(Notification.user_id == user_id)
        .where(Notification.read_at.is_(None))
        .where(Notification.cleared_at.is_(None))
        .where(or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= now))
    )
    return db.scalar(stmt) or 0


def clear_tab_notifications(
    db: Session,
    user_id: uuid.UUID,
    tab: str,
    *,
    view: str = "inbox",
) -> int:
    now = _now()
    stmt = select(Notification.id).where(Notification.user_id == user_id)
    stmt = apply_inbox_filters(stmt, db=db, user_id=user_id, tab=tab, view=view)
    ids = list(db.scalars(stmt))
    if not ids:
        return 0
    db.execute(
        update(Notification)
        .where(Notification.id.in_(ids))
        .values(cleared_at=now, read_at=func.coalesce(Notification.read_at, now))
    )
    return len(ids)


def purge_expired_cleared(db: Session, user_id: uuid.UUID) -> int:
    cutoff = _now() - timedelta(days=CLEARED_RETENTION_DAYS)
    return (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.cleared_at.is_not(None),
            Notification.cleared_at <= cutoff,
        )
        .delete(synchronize_session=False)
    )
