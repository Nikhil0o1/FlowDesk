import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.notification import Notification
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.notification import (
    InboxSettingsOut,
    InboxSettingsUpdate,
    NotificationOutExtended,
    NotificationPreferencesOut,
    NotificationPreferencesPatch,
    NotificationSummaryOut,
    SnoozeBody,
    default_snooze_until,
)
from app.services import email_service, inbox_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOutExtended])
def list_notifications(
    unread_only: bool = False,
    read_only: bool = False,
    tab: str | None = Query(None, pattern="^(primary|other|later|cleared|all)$"),
    view: str | None = Query(None, pattern="^(inbox|replies|assigned_comments)$"),
    filter: str | None = Query(None, alias="filter", pattern="^(mentions|assigned|unread|reminders)$"),
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if unread_only and read_only:
        raise HTTPException(status_code=400, detail="Cannot combine unread_only and read_only")
    settings = inbox_service.get_or_create_inbox_settings(db, user.id)
    items, total = inbox_service.list_notifications(
        db,
        user.id,
        tab=tab,
        view=view,
        filter_kind=filter,
        search=search,
        unread_only=unread_only,
        read_only=read_only,
        page=page,
        page_size=page_size,
        sort_newest_first=settings.sort_newest_first,
    )
    inbox_service.purge_expired_cleared(db, user.id)
    db.commit()
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/summary", response_model=NotificationSummaryOut)
def notification_summary(
    tab: str | None = Query(None, pattern="^(primary|other|later|cleared|all)$"),
    view: str | None = Query(None, pattern="^(inbox|replies|assigned_comments)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return inbox_service.inbox_summary(db, user.id, tab=tab or "primary", view=view or "inbox")


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"count": inbox_service.unread_inbox_count(db, user.id)}


@router.get("/replies-unread-count")
def replies_unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"count": inbox_service.unread_replies_count(db, user.id)}


@router.get("/inbox-settings", response_model=InboxSettingsOut)
def get_inbox_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    settings = inbox_service.get_or_create_inbox_settings(db, user.id)
    db.commit()
    return InboxSettingsOut.model_validate(settings)


@router.patch("/inbox-settings", response_model=InboxSettingsOut)
def patch_inbox_settings(
    body: InboxSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    settings = inbox_service.get_or_create_inbox_settings(db, user.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return InboxSettingsOut.model_validate(settings)


@router.get("/preferences", response_model=NotificationPreferencesOut)
def get_notification_preferences(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items, important_count, total = inbox_service.notification_preferences_payload(db, user.id)
    return NotificationPreferencesOut(items=items, important_count=important_count, total_count=total)


@router.patch("/preferences", response_model=NotificationPreferencesOut)
def patch_notification_preference(
    body: NotificationPreferencesPatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        inbox_service.set_type_preference(db, user.id, body.type, body.important)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    items, important_count, total = inbox_service.notification_preferences_payload(db, user.id)
    return NotificationPreferencesOut(items=items, important_count=important_count, total_count=total)


@router.post("/preferences/reset", response_model=NotificationPreferencesOut)
def reset_notification_preferences(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inbox_service.reset_type_preferences(db, user.id)
    db.commit()
    items, important_count, total = inbox_service.notification_preferences_payload(db, user.id)
    return NotificationPreferencesOut(items=items, important_count=important_count, total_count=total)


@router.post("/test-email", response_model=Message)
def send_test_notification_email(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not inbox_service.user_email_notifications_enabled(db, user.id):
        raise HTTPException(status_code=400, detail="Email notifications are disabled in your settings")
    email_service.send_test_notification_email(user.email)
    return Message(detail="Test email sent")


@router.post("/read-all", response_model=Message)
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None), Notification.cleared_at.is_(None))
        .values(read_at=now)
    )
    db.commit()
    return Message(detail="All notifications marked as read")


@router.post("/clear-tab", response_model=Message)
def clear_tab(
    tab: str = Query(..., pattern="^(primary|other|later|cleared|all)$"),
    view: str = Query("inbox", pattern="^(inbox|replies|assigned_comments)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    count = inbox_service.clear_tab_notifications(db, user.id, tab, view=view)
    db.commit()
    return Message(detail=f"Cleared {count} notification(s)")


@router.post("/{notification_id}/read", response_model=Message)
def mark_read(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
    return Message(detail="Marked as read")


@router.post("/{notification_id}/unread", response_model=Message)
def mark_unread(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.read_at = None
    db.commit()
    return Message(detail="Marked as unread")


@router.post("/{notification_id}/unclear", response_model=NotificationOutExtended)
def unclear_notification(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.cleared_at = None
    db.commit()
    db.refresh(notification)
    return inbox_service.to_notification_out(
        notification, inbox_service.is_important(db, user.id, notification.type)
    )


@router.post("/{notification_id}/unsnooze", response_model=NotificationOutExtended)
def unsnooze_notification(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.snoozed_until = None
    db.commit()
    db.refresh(notification)
    return inbox_service.to_notification_out(
        notification, inbox_service.is_important(db, user.id, notification.type)
    )


@router.post("/{notification_id}/snooze", response_model=NotificationOutExtended)
def snooze_notification(
    notification_id: uuid.UUID,
    body: SnoozeBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.snoozed_until = body.until or default_snooze_until()
    notification.cleared_at = None
    db.commit()
    db.refresh(notification)
    return inbox_service.to_notification_out(
        notification, inbox_service.is_important(db, user.id, notification.type)
    )


@router.post("/{notification_id}/clear", response_model=NotificationOutExtended)
def clear_notification(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    now = datetime.now(timezone.utc)
    notification.cleared_at = now
    if notification.read_at is None:
        notification.read_at = now
    db.commit()
    db.refresh(notification)
    return inbox_service.to_notification_out(
        notification, inbox_service.is_important(db, user.id, notification.type)
    )
