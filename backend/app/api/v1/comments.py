import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.models.comment import Comment
from app.models.project import ProjectMember
from app.models.task import Task
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.schemas.comment import CommentCreate, CommentOut, CommentUpdate
from app.schemas.common import Message, Page
from app.core.websocket import emit
from app.services import email_service, task_service
from app.services.mention_service import create_mentions, excerpt
from app.services.notification_service import notify
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


@router.get("/tasks/{task_id}/comments", response_model=Page[CommentOut])
def list_comments(
    task_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    perms.require_project_view(task.project_id)
    base = select(Comment).where(Comment.task_id == task_id, Comment.deleted_at.is_(None))
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
def create_comment(
    task_id: uuid.UUID,
    body: CommentCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    project = perms.require_project_edit(task.project_id)

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

    ref = f"{project.key}-{task.number}"
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
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        project_id=project.id,
        workspace_id=project.workspace_id,
        task_id=task_id,
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
    project = perms.require_project_view(task.project_id)
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
    project = perms.require_project_view(task.project_id)
    is_author = comment.author_id == perms.user.id
    if not is_author:
        # Admins may moderate
        perms.require_project_admin(task.project_id)
    comment.deleted_at = datetime.now(timezone.utc)
    db.commit()
    emit(
        "comment.deleted",
        task_service.task_rooms(project),
        payload={"comment_id": str(comment.id), "task_id": str(task.id)},
        project_id=project.id, workspace_id=project.workspace_id, task_id=task.id,
    )
    return Message(detail="Comment deleted")
