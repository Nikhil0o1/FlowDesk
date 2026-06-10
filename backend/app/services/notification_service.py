import uuid

from sqlalchemy.orm import Session

from app.core.websocket import emit
from app.models.notification import Notification


def notify(
    db: Session,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str | None = None,
    data: dict | None = None,
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> Notification:
    """Create an in-app notification and push it over WebSocket.

    Caller is responsible for commit; the realtime event is emitted immediately
    with the notification content (id is available after flush).
    """
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        data=data or {},
        workspace_id=workspace_id,
        project_id=project_id,
    )
    db.add(notification)
    db.flush()
    emit(
        "notification.created",
        [f"user:{user_id}"],
        payload={
            "id": str(notification.id),
            "type": type,
            "title": title,
            "body": body,
            "data": notification.data,
            "created_at": notification.created_at.isoformat() if notification.created_at else None,
            "read_at": None,
        },
        workspace_id=workspace_id,
        project_id=project_id,
    )
    return notification
