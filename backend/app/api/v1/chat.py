import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.config import settings
from app.core.websocket import emit
from app.db.session import get_db
from app.models.chat import ChatChannel, ChatMember, ChatMessage, MessageRead
from app.models.workspace import WorkspaceMember
from app.schemas.chat import (
    ChannelCreate,
    ChannelOut,
    ChannelUpdate,
    ChatMemberAdd,
    ChatMemberOut,
    MarkReadRequest,
    MessageCreate,
    MessageOut,
)
from app.schemas.common import Message, Page
from app.services.mention_service import create_mentions
from app.services.permission_service import PermissionService
from app.services.user_service import user_brief, user_briefs

router = APIRouter(tags=["chat"])


def _require_channel_member(db: Session, perms: PermissionService, channel_id: uuid.UUID) -> tuple[ChatChannel, ChatMember]:
    channel = db.get(ChatChannel, channel_id)
    if not channel or channel.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Channel not found")
    member = db.scalar(
        select(ChatMember).where(
            ChatMember.channel_id == channel_id, ChatMember.user_id == perms.user.id
        )
    )
    if not member:
        # Workspace admins / org owners can access public channels
        if not channel.is_private:
            perms.require_workspace_member(channel.workspace_id)
            member = ChatMember(channel_id=channel_id, user_id=perms.user.id, role="member")
            db.add(member)
            db.flush()
        else:
            raise HTTPException(status_code=404, detail="Channel not found")
    return channel, member


def _channel_out(db: Session, channel: ChatChannel, user_id: uuid.UUID) -> ChannelOut:
    out = ChannelOut.model_validate(channel)
    out.member_count = db.scalar(
        select(func.count(ChatMember.id)).where(ChatMember.channel_id == channel.id)
    ) or 0
    last = db.scalar(
        select(func.max(ChatMessage.created_at)).where(
            ChatMessage.channel_id == channel.id, ChatMessage.deleted_at.is_(None)
        )
    )
    out.last_message_at = last
    read = db.scalar(
        select(MessageRead).where(
            MessageRead.channel_id == channel.id, MessageRead.user_id == user_id
        )
    )
    unread_query = select(func.count(ChatMessage.id)).where(
        ChatMessage.channel_id == channel.id,
        ChatMessage.deleted_at.is_(None),
        ChatMessage.author_id != user_id,
    )
    if read and read.last_read_at:
        unread_query = unread_query.where(ChatMessage.created_at > read.last_read_at)
    out.unread_count = db.scalar(unread_query) or 0
    return out


@router.get("/workspaces/{workspace_id}/channels", response_model=list[ChannelOut])
def list_channels(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    my_channels = select(ChatMember.channel_id).where(ChatMember.user_id == perms.user.id)
    channels = db.scalars(
        select(ChatChannel)
        .where(
            ChatChannel.workspace_id == workspace_id,
            ChatChannel.deleted_at.is_(None),
            (ChatChannel.is_private.is_(False)) | (ChatChannel.id.in_(my_channels)),
        )
        .order_by(ChatChannel.is_direct, ChatChannel.created_at)
    ).all()
    return [_channel_out(db, c, perms.user.id) for c in channels]


@router.post("/workspaces/{workspace_id}/channels", response_model=ChannelOut, status_code=201)
def create_channel(
    workspace_id: uuid.UUID,
    body: ChannelCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    # Workspace members can create channels; admins manage them
    perms.require_workspace_member(workspace_id)
    if body.project_id:
        perms.require_project_view(body.project_id)
    channel = ChatChannel(
        workspace_id=workspace_id,
        project_id=body.project_id,
        name=body.name.lower().replace(" ", "-")[:120],
        description=body.description,
        is_private=body.is_private,
        created_by=perms.user.id,
    )
    db.add(channel)
    db.flush()
    db.add(ChatMember(channel_id=channel.id, user_id=perms.user.id, role="admin"))
    valid_member_ids = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)
        ).all()
    )
    for uid in set(body.member_ids):
        if uid != perms.user.id and uid in valid_member_ids:
            db.add(ChatMember(channel_id=channel.id, user_id=uid, role="member"))
    db.commit()
    return _channel_out(db, channel, perms.user.id)


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
def update_channel(
    channel_id: uuid.UUID,
    body: ChannelUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel, member = _require_channel_member(db, perms, channel_id)
    if member.role != "admin":
        perms.require_workspace_admin(channel.workspace_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(channel, field, value)
    db.commit()
    return _channel_out(db, channel, perms.user.id)


@router.delete("/channels/{channel_id}", response_model=Message)
def delete_channel(
    channel_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel = db.get(ChatChannel, channel_id)
    if not channel or channel.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Channel not found")
    perms.require_workspace_admin(channel.workspace_id)
    channel.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Message(detail="Channel deleted")


@router.get("/channels/{channel_id}/members", response_model=list[ChatMemberOut])
def list_channel_members(
    channel_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    _require_channel_member(db, perms, channel_id)
    members = db.scalars(
        select(ChatMember).where(ChatMember.channel_id == channel_id)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    result = []
    for m in members:
        out = ChatMemberOut.model_validate(m)
        out.user = briefs.get(m.user_id)
        result.append(out)
    return result


@router.post("/channels/{channel_id}/members", response_model=Message)
def add_channel_members(
    channel_id: uuid.UUID,
    body: ChatMemberAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel, member = _require_channel_member(db, perms, channel_id)
    valid_ids = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(
                WorkspaceMember.workspace_id == channel.workspace_id
            )
        ).all()
    )
    existing = set(
        db.scalars(select(ChatMember.user_id).where(ChatMember.channel_id == channel_id)).all()
    )
    added = 0
    for uid in set(body.user_ids):
        if uid in valid_ids and uid not in existing:
            db.add(ChatMember(channel_id=channel_id, user_id=uid, role="member"))
            added += 1
    db.commit()
    return Message(detail=f"{added} member(s) added")


@router.delete("/channels/{channel_id}/members/{member_user_id}", response_model=Message)
def remove_channel_member(
    channel_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel, member = _require_channel_member(db, perms, channel_id)
    if member.role != "admin" and member_user_id != perms.user.id:
        perms.require_workspace_admin(channel.workspace_id)
    target = db.scalar(
        select(ChatMember).where(
            ChatMember.channel_id == channel_id, ChatMember.user_id == member_user_id
        )
    )
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(target)
    db.commit()
    return Message(detail="Member removed")


@router.get("/channels/{channel_id}/messages", response_model=Page[MessageOut])
def list_messages(
    channel_id: uuid.UUID,
    before: datetime | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    _require_channel_member(db, perms, channel_id)
    db.commit()  # persist potential auto-join
    base = select(ChatMessage).where(
        ChatMessage.channel_id == channel_id, ChatMessage.deleted_at.is_(None)
    )
    if before:
        base = base.where(ChatMessage.created_at < before)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(ChatMessage.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    rows = list(reversed(rows))
    briefs = user_briefs(db, [m.author_id for m in rows])
    items = []
    for m in rows:
        out = MessageOut.model_validate(m)
        out.author = briefs.get(m.author_id)
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.post("/channels/{channel_id}/messages", response_model=MessageOut, status_code=201)
def send_message(
    channel_id: uuid.UUID,
    body: MessageCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel, _member = _require_channel_member(db, perms, channel_id)
    if body.parent_message_id:
        parent = db.get(ChatMessage, body.parent_message_id)
        if not parent or parent.channel_id != channel_id:
            raise HTTPException(status_code=400, detail="Parent message not found")
    message = ChatMessage(
        channel_id=channel_id,
        author_id=perms.user.id,
        parent_message_id=body.parent_message_id,
        body=body.body,
    )
    db.add(message)
    db.flush()

    # Mentions in chat -> notification + email (important mentions only -> email on)
    channel_member_ids = set(
        db.scalars(select(ChatMember.user_id).where(ChatMember.channel_id == channel_id)).all()
    )
    mentioned = create_mentions(
        db,
        body=body.body,
        author=perms.user,
        allowed_user_ids=channel_member_ids,
        chat_message_id=message.id,
        context_label=f"#{channel.name}",
        url=f"{settings.FRONTEND_URL}/app/chat?channel={channel_id}",
        workspace_id=channel.workspace_id,
        project_id=channel.project_id,
    )

    # Sender has implicitly read their own message
    read = db.scalar(
        select(MessageRead).where(
            MessageRead.channel_id == channel_id, MessageRead.user_id == perms.user.id
        )
    )
    now = datetime.now(timezone.utc)
    if read:
        read.last_read_message_id = message.id
        read.last_read_at = now
    else:
        db.add(
            MessageRead(
                channel_id=channel_id, user_id=perms.user.id,
                last_read_message_id=message.id, last_read_at=now,
            )
        )

    author = user_brief(db, perms.user.id)
    emit(
        "chat.message.created",
        [f"channel:{channel_id}"],
        payload={
            "message_id": str(message.id),
            "channel_id": str(channel_id),
            "author_id": str(perms.user.id),
            "author_name": author.full_name if author else "",
            "author_avatar": author.avatar_url if author else None,
            "body": message.body,
            "parent_message_id": str(body.parent_message_id) if body.parent_message_id else None,
            "created_at": now.isoformat(),
            "mentioned_user_ids": [str(u) for u in mentioned],
        },
        workspace_id=channel.workspace_id,
    )
    db.commit()
    out = MessageOut.model_validate(message)
    out.author = author
    return out


@router.post("/channels/{channel_id}/read", response_model=Message)
def mark_channel_read(
    channel_id: uuid.UUID,
    body: MarkReadRequest,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    _require_channel_member(db, perms, channel_id)
    message = db.get(ChatMessage, body.message_id)
    if not message or message.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Message not found")
    read = db.scalar(
        select(MessageRead).where(
            MessageRead.channel_id == channel_id, MessageRead.user_id == perms.user.id
        )
    )
    now = datetime.now(timezone.utc)
    if read:
        read.last_read_message_id = body.message_id
        read.last_read_at = now
    else:
        db.add(
            MessageRead(
                channel_id=channel_id, user_id=perms.user.id,
                last_read_message_id=body.message_id, last_read_at=now,
            )
        )
    emit(
        "chat.read",
        [f"channel:{channel_id}"],
        payload={"channel_id": str(channel_id), "user_id": str(perms.user.id),
                 "message_id": str(body.message_id)},
    )
    db.commit()
    return Message(detail="Marked as read")
