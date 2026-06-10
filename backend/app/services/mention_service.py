"""Parse @mentions from comment/chat bodies and fan out records + notifications.

Mention syntax produced by the frontend mentions input: @[Display Name](<user-uuid>)
"""
import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.comment import Mention
from app.models.user import User
from app.services import email_service
from app.services.notification_service import notify

MENTION_RE = re.compile(r"@\[[^\]]+\]\(([0-9a-fA-F-]{36})\)")


def extract_mentioned_user_ids(body: str) -> list[uuid.UUID]:
    ids = []
    for raw in MENTION_RE.findall(body or ""):
        try:
            ids.append(uuid.UUID(raw))
        except ValueError:
            continue
    return list(dict.fromkeys(ids))  # dedupe, keep order


def excerpt(body: str, limit: int = 280) -> str:
    # Replace mention markup with plain @Name for emails/notifications
    plain = re.sub(r"@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)", r"@\1", body or "")
    return plain[:limit] + ("…" if len(plain) > limit else "")


def create_mentions(
    db: Session,
    *,
    body: str,
    author: User,
    allowed_user_ids: set[uuid.UUID],
    comment_id: uuid.UUID | None = None,
    chat_message_id: uuid.UUID | None = None,
    context_label: str,
    url: str,
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    email_important_only: bool = False,
) -> list[uuid.UUID]:
    """Create mention rows + notifications (+ emails) for valid mentioned users.

    Mentions never create users; ids outside allowed_user_ids are ignored.
    Caller commits.
    """
    author_name = (
        author.profile.full_name if author.profile and author.profile.full_name else author.email
    )
    mentioned = extract_mentioned_user_ids(body)
    created: list[uuid.UUID] = []
    for user_id in mentioned:
        if user_id == author.id or user_id not in allowed_user_ids:
            continue
        user = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
        if not user:
            continue
        db.add(
            Mention(
                mentioned_user_id=user_id,
                created_by=author.id,
                comment_id=comment_id,
                chat_message_id=chat_message_id,
            )
        )
        notify(
            db, user_id,
            "comment_mention" if comment_id else "chat_mention",
            f"{author_name} mentioned you in {context_label}",
            excerpt(body),
            data={
                "comment_id": str(comment_id) if comment_id else None,
                "chat_message_id": str(chat_message_id) if chat_message_id else None,
                "url": url,
            },
            workspace_id=workspace_id,
            project_id=project_id,
        )
        if not email_important_only:
            email_service.send_mention_email(user.email, author_name, context_label, excerpt(body), url)
        created.append(user_id)
    return created
