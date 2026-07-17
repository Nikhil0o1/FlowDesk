import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.core.pat_route_registry import pat_allow
from app.core.task_ref import format_task_ref
from app.db.session import get_db
from app.models.chat import ChatChannel, ChatMessage
from app.models.comment import Comment, Mention
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.schemas.comment import AssignedItemOut, CommentCreate, CommentOut, CommentUpdate
from app.schemas.common import Message, Page
from app.core.websocket import emit
from app.services import email_service, task_service, webhook_service
from app.services.mention_service import create_mentions, excerpt
from app.services.notification_service import notify
from app.services.task_follow_service import maybe_auto_follow, notify_followers_on_comment
from app.services.permission_service import PermissionService
from app.services.user_service import user_brief, user_briefs

router = APIRouter(tags=["comments"])


def _commentable_user_ids(db: Session, project_id: uuid.UUID, workspace_id: uuid.UUID) -> set[uuid.UUID]:
    """Users who may be mentioned: project members + workspace members."""
    ids = set(
        db.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)).all()
    )
    ids |= set(
        db.scalars(
            select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)
        ).all()
    )
    return ids


def _apply_comment_scope(base, scope: str | None):
    """Filter comments: local (Activity) vs github (Development panel)."""
    if scope == "local":
        return base.where(
            Comment.github_comment_id.is_(None),
            Comment.github_author_login.is_(None),
        )
    if scope == "github":
        return base.where(
            or_(
                Comment.github_comment_id.isnot(None),
                Comment.github_author_login.isnot(None),
            )
        )
    return base


@router.get("/me/assigned-comments", response_model=list[AssignedItemOut])
def my_assigned_comments(
    relation: str = Query("assigned", pattern="^(assigned|delegated)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    perms: PermissionService = Depends(get_permissions),
):
    """@mentions surfaced on the Assigned Comments page.

    - relation="assigned":  comments/messages where the user was mentioned.
    - relation="delegated": comments/messages where the user mentioned someone else.

    Aggregates task-comment mentions and chat mentions.
    """
    if relation == "assigned":
        mine = Mention.mentioned_user_id == user.id
    else:
        mine = and_(Mention.created_by == user.id, Mention.mentioned_user_id != user.id)

    # The "other party" shown on each card: the assigner (assigned to me) or the
    # assignee (delegated by me).
    def person_id(m: Mention) -> uuid.UUID | None:
        return m.created_by if relation == "assigned" else m.mentioned_user_id

    accessible = perms.accessible_project_ids()
    comment_rows: list = []
    if accessible:
        comment_rows = db.execute(
            select(Mention, Comment, Task)
            .join(Comment, Mention.comment_id == Comment.id)
            .join(Task, Comment.task_id == Task.id)
            .where(
                mine,
                Mention.comment_id.isnot(None),
                Comment.deleted_at.is_(None),
                Task.deleted_at.is_(None),
                Task.project_id.in_(accessible),
            )
            .order_by(Mention.created_at.desc())
            .limit(200)
        ).all()

    chat_rows = db.execute(
        select(Mention, ChatMessage, ChatChannel)
        .join(ChatMessage, Mention.chat_message_id == ChatMessage.id)
        .join(ChatChannel, ChatMessage.channel_id == ChatChannel.id)
        .where(
            mine,
            Mention.chat_message_id.isnot(None),
            ChatMessage.deleted_at.is_(None),
            ChatChannel.deleted_at.is_(None),
        )
        .order_by(Mention.created_at.desc())
        .limit(200)
    ).all()

    if not comment_rows and not chat_rows:
        return []

    person_ids = [person_id(m) for (m, *_rest) in comment_rows]
    person_ids += [person_id(m) for (m, *_rest) in chat_rows]
    briefs = user_briefs(db, [pid for pid in person_ids if pid])

    project_ids = {task.project_id for _m, _c, task in comment_rows}
    projects = (
        {p.id: p for p in db.scalars(select(Project).where(Project.id.in_(project_ids))).all()}
        if project_ids
        else {}
    )

    items: list[AssignedItemOut] = []
    for mention, comment, task in comment_rows:
        project = projects.get(task.project_id)
        items.append(
            AssignedItemOut(
                id=mention.id,
                source="task",
                title=task.title,
                ref=format_task_ref(task.project_id, task.number),
                context=project.name if project else "",
                preview=excerpt(comment.body, 200),
                url=f"/app/tasks/{task.id}",
                person=briefs.get(person_id(mention)),
                at=mention.created_at,
                priority=task.priority,
                status="pending",
            )
        )
    for mention, message, channel in chat_rows:
        items.append(
            AssignedItemOut(
                id=mention.id,
                source="chat",
                title=channel.name,
                ref=None,
                context="Chat",
                preview=excerpt(message.body, 200),
                url=f"/app/chat?channel={channel.id}",
                person=briefs.get(person_id(mention)),
                at=mention.created_at,
                priority=None,
                status="pending",
            )
        )
    items.sort(key=lambda i: i.at, reverse=True)
    return items[:200]


@router.get("/tasks/{task_id}/comments", response_model=Page[CommentOut])
@pat_allow(
    "comments:read",
    rate_category="standard",
    authz_class="object",
    tenant_resolution="Task object auth",
)
def list_comments(
    task_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    scope: str | None = Query(None, pattern="^(local|github)$"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_task_view(task)
    base = select(Comment).where(Comment.task_id == task_id, Comment.deleted_at.is_(None))
    base = _apply_comment_scope(base, scope)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    comments = db.scalars(
        base.order_by(Comment.created_at.asc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    briefs = user_briefs(db, [c.author_id for c in comments])
    reply_counts = dict(
        db.execute(
            select(Comment.parent_comment_id, func.count(Comment.id))
            .where(
                Comment.parent_comment_id.in_([c.id for c in comments]),
                Comment.deleted_at.is_(None),
            )
            .group_by(Comment.parent_comment_id)
        ).all()
    ) if comments else {}
    items = []
    for c in comments:
        out = CommentOut.model_validate(c)
        out.author = briefs.get(c.author_id)
        out.reply_count = reply_counts.get(c.id, 0)
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.post("/tasks/{task_id}/comments", response_model=CommentOut, status_code=201)
@pat_allow(
    "comments:write",
    rate_category="standard_write",
    authz_class="object",
    tenant_resolution="Task object auth",
)
def create_comment(
    task_id: uuid.UUID,
    body: CommentCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_task_edit(task)
    project = perms.get_project_or_404(task.project_id)

    parent: Comment | None = None
    if body.parent_comment_id:
        parent = db.get(Comment, body.parent_comment_id)
        if not parent or parent.task_id != task_id or parent.deleted_at is not None:
            raise HTTPException(status_code=400, detail="Parent comment not found")
        if parent.parent_comment_id is not None:
            raise HTTPException(status_code=400, detail="Replies cannot be nested further")

    comment = Comment(
        task_id=task_id,
        author_id=perms.user.id,
        parent_comment_id=body.parent_comment_id,
        body=body.body,
    )
    db.add(comment)
    db.flush()

    ref = format_task_ref(project.id, task.number)
    url = task_service.task_url(task.id)
    author_name = (
        perms.user.profile.full_name
        if perms.user.profile and perms.user.profile.full_name
        else perms.user.email
    )

    # Mentions -> records + notifications + emails (only users with project access)
    allowed = _commentable_user_ids(db, project.id, project.workspace_id)
    mentioned = create_mentions(
        db,
        body=body.body,
        author=perms.user,
        allowed_user_ids=allowed,
        comment_id=comment.id,
        task_id=task_id,
        context_label=f"a comment on {ref}",
        url=url,
        workspace_id=project.workspace_id,
        project_id=project.id,
    )
    comment_id_str = str(comment.id)

    # Reply notification (skip if the parent author was already mentioned)
    if parent and parent.author_id != perms.user.id and parent.author_id not in mentioned:
        notify(
            db, parent.author_id, "comment_reply",
            f"{author_name} replied to your comment on {ref}",
            excerpt(body.body),
            data={"task_id": str(task_id), "comment_id": str(comment.id)},
            workspace_id=project.workspace_id, project_id=project.id,
        )
        parent_author = db.get(User, parent.author_id)
        if parent_author:
            email_service.send_comment_reply_email(
                parent_author.email, author_name, ref, excerpt(body.body), url
            )

    maybe_auto_follow(db, perms.user.id, task_id)
    exclude_notify = {perms.user.id, *mentioned}
    if parent:
        exclude_notify.add(parent.author_id)
    notify_followers_on_comment(
        db,
        task=task,
        project=project,
        author=perms.user,
        body=body.body,
        comment_id=comment.id,
        task_ref=ref,
        url=url,
        exclude_user_ids=exclude_notify,
    )

    task_service.log_task_activity(
        db, project, task, "comment.created", perms.user.id, {"comment_id": comment_id_str}
    )
    comment_body = comment.body
    db.commit()
    # Emit only after commit so receivers refetch committed data
    if mentioned:
        emit(
            "mention.created",
            [f"user:{uid}" for uid in mentioned],
            payload={"comment_id": comment_id_str, "task_id": str(task_id)},
            project_id=project.id,
            workspace_id=project.workspace_id,
        )
    emit(
        "comment.created",
        task_service.task_rooms(project),
        payload={
            "comment_id": comment_id_str,
            "task_id": str(task_id),
            "author_id": str(perms.user.id),
            "body": comment_body,
            "parent_comment_id": str(body.parent_comment_id) if body.parent_comment_id else None,
            "comment_scope": "local",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        project_id=project.id,
        workspace_id=project.workspace_id,
        task_id=task_id,
    )
    if not task.is_private:
        webhook_service.enqueue_workspace_event(
            db,
            project.workspace_id,
            "comment.added",
            {
                "comment_id": comment_id_str,
                "task_id": str(task_id),
                "task_ref": ref,
                "project_id": str(project.id),
                "workspace_id": str(project.workspace_id),
                "author_id": str(perms.user.id),
                "body": comment_body,
                "parent_comment_id": str(body.parent_comment_id) if body.parent_comment_id else None,
            },
        )

    out = CommentOut.model_validate(comment)
    out.author = user_brief(db, perms.user.id)
    return out


@router.patch("/comments/{comment_id}", response_model=CommentOut)
def update_comment(
    comment_id: uuid.UUID,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    comment = db.get(Comment, comment_id)
    if not comment or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")
    task = db.get(Task, comment.task_id)
    perms.require_task_view(task)
    project = perms.get_project_or_404(task.project_id)
    if comment.author_id != perms.user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own comments")
    comment.body = body.body
    db.commit()
    emit(
        "comment.updated",
        task_service.task_rooms(project),
        payload={"comment_id": str(comment.id), "task_id": str(task.id), "body": comment.body},
        project_id=project.id, workspace_id=project.workspace_id, task_id=task.id,
    )
    out = CommentOut.model_validate(comment)
    out.author = user_brief(db, comment.author_id)
    return out


@router.delete("/comments/{comment_id}", response_model=Message)
def delete_comment(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    comment = db.get(Comment, comment_id)
    if not comment or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")
    task = db.get(Task, comment.task_id)
    perms.require_task_view(task)
    project = perms.get_project_or_404(task.project_id)
    is_author = comment.author_id == perms.user.id
    if not is_author:
        # Admins may moderate
        perms.require_task_admin(task)
    comment.deleted_at = datetime.now(timezone.utc)
    db.commit()
    emit(
        "comment.deleted",
        task_service.task_rooms(project),
        payload={"comment_id": str(comment.id), "task_id": str(task.id)},
        project_id=project.id, workspace_id=project.workspace_id, task_id=task.id,
    )
    return Message(detail="Comment deleted")
