"""Parse @mentions from comment/chat bodies and fan out records + notifications.

Mention syntax produced by the frontend mentions input: @[Display Name](<user-uuid>)
Doc body people chips: data-mention-type="people" data-mention-id="<uuid>"
"""
import html
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.comment import Mention
from app.models.notification import Notification
from app.models.user import User
from app.services import email_service
from app.services.notification_service import notify

logger = logging.getLogger(__name__)
# Prevent duplicate inbox rows when picker notify + autosave both fire for the same @.
_DOC_MENTION_DEDUPE_SECONDS = 45

MENTION_RE = re.compile(r"@\[[^\]]+\]\(([0-9a-fA-F-]{36})\)")
# "@all" is serialized by the frontend as @[All](all) — mentions everyone in the
# context (all channel members / all project members).
MENTION_ALL_RE = re.compile(r"@\[[^\]]+\]\(all\)")
# Doc editor @All people chip: data-mention-id="all"
_DOC_CHIP_ALL_RE = re.compile(r'\bdata-mention-id=["\']all["\']', re.IGNORECASE)
# Doc editor people chips — attribute order may vary.
_DOC_CHIP_PEOPLE_RE = re.compile(
    r'<[^>]*\bdata-mention-type=["\']people["\'][^>]*\bdata-mention-id=["\']([0-9a-fA-F-]{36})["\'][^>]*>'
    r'|<[^>]*\bdata-mention-id=["\']([0-9a-fA-F-]{36})["\'][^>]*\bdata-mention-type=["\']people["\'][^>]*>',
    re.IGNORECASE,
)
# Template for capturing the visible label text of a people chip (``{uid}`` filled at runtime).
_DOC_CHIP_LABEL_TMPL = (
    r'<[^>]*\bdata-mention-type=["\']people["\'][^>]*\bdata-mention-id=["\']{uid}["\'][^>]*>(.*?)</(?:span|a)>'
    r'|<[^>]*\bdata-mention-id=["\']{uid}["\'][^>]*\bdata-mention-type=["\']people["\'][^>]*>(.*?)</(?:span|a)>'
)
_DOC_CHIP_ALL_LABEL_RE = re.compile(
    r'<[^>]*\bdata-mention-type=["\']people["\'][^>]*\bdata-mention-id=["\']all["\'][^>]*>(.*?)</(?:span|a)>'
    r'|<[^>]*\bdata-mention-id=["\']all["\'][^>]*\bdata-mention-type=["\']people["\'][^>]*>(.*?)</(?:span|a)>',
    re.IGNORECASE | re.DOTALL,
)


def extract_mentioned_user_ids(body: str) -> list[uuid.UUID]:
    ids = []
    for raw in MENTION_RE.findall(body or ""):
        try:
            ids.append(uuid.UUID(raw))
        except ValueError:
            continue
    return list(dict.fromkeys(ids))  # dedupe, keep order


def extract_doc_html_people_ids(html: str) -> list[uuid.UUID]:
    """User ids from doc-body people mention chips (+ classic @[Name](uuid) markup)."""
    ids: list[uuid.UUID] = []
    for a, b in _DOC_CHIP_PEOPLE_RE.findall(html or ""):
        raw = a or b
        try:
            ids.append(uuid.UUID(raw))
        except ValueError:
            continue
    ids.extend(extract_mentioned_user_ids(html or ""))
    return list(dict.fromkeys(ids))


def mentions_everyone(body: str) -> bool:
    text = body or ""
    return bool(MENTION_ALL_RE.search(text) or _DOC_CHIP_ALL_RE.search(text))


def plain_text_from_rich_body(body: str) -> str:
    """Turn comment markup / doc HTML into a single-line inbox-friendly string."""
    plain = re.sub(r"@\[([^\]]+)\]\((?:[0-9a-fA-F-]{36}|all)\)", r"@\1", body or "")
    # Preserve paragraph/line breaks as spaces for the cleaned preview.
    plain = re.sub(r"<br\s*/?>", " ", plain, flags=re.IGNORECASE)
    plain = re.sub(r"</(?:p|div|li|h[1-6]|tr)\s*>", " ", plain, flags=re.IGNORECASE)
    plain = re.sub(r"<[^>]+>", " ", plain)
    plain = html.unescape(plain)
    # Editor often inserts &nbsp; / NBSPs between words — normalize them away.
    plain = plain.replace("\xa0", " ").replace("\u200b", "").replace("\ufeff", "")
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain


def excerpt(body: str, limit: int = 280) -> str:
    """Plain preview for emails/notifications — no HTML tags or entities."""
    plain = plain_text_from_rich_body(body)
    if len(plain) <= limit:
        return plain
    return plain[:limit].rstrip() + "…"


def _center_excerpt(plain: str, needle: str, *, limit: int = 160) -> str:
    """Clip ``plain`` around the first case-insensitive match of ``needle``."""
    if not plain:
        return ""
    if not needle:
        return excerpt(plain, limit=limit)
    idx = plain.lower().find(needle.lower())
    if idx < 0 and needle.startswith("@"):
        needle = needle[1:]
        idx = plain.lower().find(needle.lower())
    if idx < 0:
        return excerpt(plain, limit=limit)

    radius = max(40, (limit - len(needle)) // 2)
    start = max(0, idx - radius)
    end = min(len(plain), idx + len(needle) + radius)
    # Prefer word boundaries so we don't clip mid-token when possible.
    if start > 0:
        space = plain.find(" ", start)
        if 0 < space < idx:
            start = space + 1
    if end < len(plain):
        space = plain.rfind(" ", idx + len(needle), end)
        if space > idx:
            end = space

    snip = plain[start:end].strip()
    if start > 0:
        snip = "…" + snip
    if end < len(plain):
        snip = snip + "…"
    return snip if len(snip) <= limit else snip[:limit].rstrip() + "…"


def doc_body_mention_excerpt(html_body: str, user_id: uuid.UUID, *, limit: int = 160) -> str:
    """Short, centered preview around a people-mention chip for inbox rows."""
    plain = plain_text_from_rich_body(html_body)
    if not plain:
        return ""

    label = ""
    pattern = _DOC_CHIP_LABEL_TMPL.replace("{uid}", re.escape(str(user_id)))
    match = re.search(pattern, html_body or "", flags=re.IGNORECASE | re.DOTALL)
    if match:
        raw_label = match.group(1) or match.group(2) or ""
        label = plain_text_from_rich_body(raw_label)

    return _center_excerpt(plain, label, limit=limit)


def doc_body_all_mention_excerpt(html_body: str, *, limit: int = 160) -> str:
    """Short preview around the @All chip — no duplicated @All sentinel."""
    plain = plain_text_from_rich_body(html_body)
    if not plain:
        return ""
    label = "@All"
    match = _DOC_CHIP_ALL_LABEL_RE.search(html_body or "")
    if match:
        raw_label = match.group(1) or match.group(2) or ""
        label = plain_text_from_rich_body(raw_label) or "@All"
    return _center_excerpt(plain, label, limit=limit)


def _recent_doc_mention_exists(
    db: Session,
    *,
    user_id: uuid.UUID,
    document_id: uuid.UUID,
    within_seconds: int = _DOC_MENTION_DEDUPE_SECONDS,
) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=within_seconds)
    rows = db.scalars(
        select(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.type == "doc_mention",
            Notification.created_at >= cutoff,
        )
        .order_by(Notification.created_at.desc())
        .limit(20)
    ).all()
    doc_key = str(document_id)
    return any((n.data or {}).get("document_id") == doc_key for n in rows)


def create_mentions(
    db: Session,
    *,
    body: str,
    author: User,
    allowed_user_ids: set[uuid.UUID],
    comment_id: uuid.UUID | None = None,
    chat_message_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    document_comment_id: uuid.UUID | None = None,
    document_id: uuid.UUID | None = None,
    context_label: str,
    url: str,
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    email_important_only: bool = False,
    notification_type: str | None = None,
    target_user_ids: list[uuid.UUID] | None = None,
    all_user_ids: set[uuid.UUID] | None = None,
    dedupe_doc_mentions: bool = False,
) -> list[uuid.UUID]:
    """Create mention rows + notifications (+ emails) for valid mentioned users.

    Mentions never create users; ids outside the notify allow-list are ignored.
    Caller commits.
    When ``target_user_ids`` is set, only those users are notified (still constrained
    by the allow-list); otherwise targets are parsed from ``body``.
    When body contains @all, expansion uses ``all_user_ids`` if provided, else
    ``allowed_user_ids``.
    """
    author_name = (
        author.profile.full_name if author.profile and author.profile.full_name else author.email
    )
    if target_user_ids is not None:
        targets = list(dict.fromkeys(target_user_ids))
    else:
        targets = extract_mentioned_user_ids(body)
        if mentions_everyone(body):
            expand = all_user_ids if all_user_ids is not None else allowed_user_ids
            for uid in expand:
                if uid not in targets:
                    targets.append(uid)

    notify_allow = set(allowed_user_ids) | (all_user_ids or set())
    created: list[uuid.UUID] = []
    for user_id in targets:
        if user_id == author.id or user_id not in notify_allow:
            continue
        user = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
        if not user:
            continue
        ntype = notification_type or (
            "comment_mention"
            if comment_id
            else "chat_mention"
            if chat_message_id
            else "doc_mention"
        )
        if (
            dedupe_doc_mentions
            and ntype == "doc_mention"
            and document_id is not None
            and _recent_doc_mention_exists(db, user_id=user_id, document_id=document_id)
        ):
            continue
        db.add(
            Mention(
                mentioned_user_id=user_id,
                created_by=author.id,
                comment_id=comment_id,
                chat_message_id=chat_message_id,
                document_comment_id=document_comment_id,
            )
        )
        preview = excerpt(body)
        notify(
            db, user_id,
            ntype,
            f"{author_name} mentioned you in {context_label}",
            preview,
            data={
                "comment_id": str(comment_id) if comment_id else None,
                "chat_message_id": str(chat_message_id) if chat_message_id else None,
                "task_id": str(task_id) if task_id else None,
                "document_comment_id": str(document_comment_id) if document_comment_id else None,
                "document_id": str(document_id) if document_id else None,
                "url": url,
            },
            workspace_id=workspace_id,
            project_id=project_id,
        )
        if not email_important_only:
            from app.services.inbox_service import user_email_notifications_enabled

            try:
                if user_email_notifications_enabled(db, user_id):
                    email_service.send_mention_email(
                        user.email, author_name, context_label, preview, url
                    )
            except Exception:
                # Email must never roll back in-app mention notifications / doc saves.
                logger.exception("mention email failed for user=%s", user_id)
        created.append(user_id)
    return created


def notify_doc_people_mentions(
    db: Session,
    *,
    author: User,
    allowed_user_ids: set[uuid.UUID],
    document_id: uuid.UUID,
    user_ids: list[uuid.UUID] | None = None,
    mention_all: bool = False,
    all_user_ids: set[uuid.UUID] | None = None,
    context_label: str,
    url: str,
    workspace_id: uuid.UUID | None = None,
    preview_html: str | None = None,
) -> list[uuid.UUID]:
    """Notify @mentioned people in a document body (picker / paste / @all)."""
    if mention_all or (preview_html and mentions_everyone(preview_html) and not user_ids):
        # Use the doc snippet only — do not prefix @[All](all) (that duplicated "@All" in inbox).
        preview = (
            doc_body_all_mention_excerpt(preview_html or "") if preview_html else ""
        ) or "You were mentioned in this document"
        expand = all_user_ids if all_user_ids is not None else allowed_user_ids
        # Explicit targets — body is display-only; expansion does not parse it.
        targets = [uid for uid in expand if uid != author.id]
        if not targets:
            return []
        return create_mentions(
            db,
            body=preview,
            author=author,
            allowed_user_ids=allowed_user_ids,
            all_user_ids=expand,
            document_id=document_id,
            context_label=context_label,
            url=url,
            workspace_id=workspace_id,
            notification_type="doc_mention",
            target_user_ids=targets,
            dedupe_doc_mentions=True,
        )

    created: list[uuid.UUID] = []
    for uid in list(dict.fromkeys(user_ids or [])):
        preview = (
            doc_body_mention_excerpt(preview_html, uid)
            if preview_html
            else ""
        ) or "You were mentioned in this document"
        created.extend(
            create_mentions(
                db,
                body=preview,
                author=author,
                allowed_user_ids=allowed_user_ids,
                document_id=document_id,
                context_label=context_label,
                url=url,
                workspace_id=workspace_id,
                notification_type="doc_mention",
                target_user_ids=[uid],
                dedupe_doc_mentions=True,
            )
        )
    return created


def notify_new_doc_body_mentions(
    db: Session,
    *,
    author: User,
    allowed_user_ids: set[uuid.UUID],
    document_id: uuid.UUID,
    previous_html: str | None,
    next_html: str | None,
    context_label: str,
    url: str,
    workspace_id: uuid.UUID | None = None,
    all_user_ids: set[uuid.UUID] | None = None,
) -> list[uuid.UUID]:
    """Notify users newly present as people chips (including newly added @All) in saved HTML."""
    prev = previous_html or ""
    nxt = next_html or ""
    created: list[uuid.UUID] = []

    if mentions_everyone(nxt) and not mentions_everyone(prev):
        created.extend(
            notify_doc_people_mentions(
                db,
                author=author,
                allowed_user_ids=allowed_user_ids,
                document_id=document_id,
                mention_all=True,
                all_user_ids=all_user_ids,
                context_label=context_label,
                url=url,
                workspace_id=workspace_id,
                preview_html=nxt,
            )
        )

    prev_ids = set(extract_doc_html_people_ids(prev))
    added = [uid for uid in extract_doc_html_people_ids(nxt) if uid not in prev_ids]
    if added:
        created.extend(
            notify_doc_people_mentions(
                db,
                author=author,
                allowed_user_ids=allowed_user_ids,
                document_id=document_id,
                user_ids=added,
                context_label=context_label,
                url=url,
                workspace_id=workspace_id,
                preview_html=nxt,
            )
        )
    return list(dict.fromkeys(created))
