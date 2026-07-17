import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.config import settings
from app.core.rate_limit import limiter, upload_rate_key
from app.core.websocket import emit
from app.db.session import get_db
from app.models.chat import ChatAttachment, ChatChannel, ChatMember, ChatMessage, MessageRead
from app.models.organization import OrganizationMember
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.chat import (
    ChannelCreate,
    ChannelOut,
    ChannelUpdate,
    ChatAttachmentOut,
    ChatMemberAdd,
    ChatMemberOut,
    MarkReadRequest,
    MessageCreate,
    MessageOut,
    MessageUpdate,
)
from app.schemas.common import Message, Page
from app.services.chat_service import (
    ensure_general_channel,
    public_channel_user_ids,
    sync_public_channel_members,
)
from app.services.mention_service import create_mentions, extract_mentioned_user_ids, mentions_everyone
from app.services.permission_service import PermissionService
from app.services.storage_service import build_key, get_storage, safe_download_media_type, validate_upload
from app.services.upload_service import guard_upload_request, max_attachment_bytes, read_bounded_upload
from app.services.user_service import user_brief, user_briefs

router = APIRouter(tags=["chat"])


def _org_owner_ids(db: Session, workspace_id: uuid.UUID) -> set[uuid.UUID]:
    workspace = db.get(Workspace, workspace_id)
    if not workspace:
        return set()
    return set(
        db.scalars(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == workspace.organization_id,
                OrganizationMember.role == "owner",
            )
        ).all()
    )


def _workspace_member_roles(db: Session, workspace_id: uuid.UUID) -> dict[uuid.UUID, str]:
    return {
        user_id: role
        for user_id, role in db.execute(
            select(WorkspaceMember.user_id, WorkspaceMember.role).where(
                WorkspaceMember.workspace_id == workspace_id
            )
        ).all()
    }


def _effective_chat_role(
    user_id: uuid.UUID,
    chat_role: str | None,
    workspace_role: str | None,
    org_owner_ids: set[uuid.UUID],
) -> str:
    if user_id in org_owner_ids or workspace_role == "owner":
        return "owner"
    if workspace_role == "admin" or chat_role == "admin":
        return "admin"
    return chat_role or "member"


def _ensure_public_channel_members(db: Session, channel: ChatChannel) -> None:
    if channel.is_private:
        return
    workspace_user_ids = public_channel_user_ids(db, channel.workspace_id)
    existing_user_ids = set(
        db.scalars(select(ChatMember.user_id).where(ChatMember.channel_id == channel.id)).all()
    )
    for user_id in workspace_user_ids - existing_user_ids:
        db.add(ChatMember(channel_id=channel.id, user_id=user_id, role="member"))
    if workspace_user_ids - existing_user_ids:
        db.flush()


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
        if not channel.is_private:
            perms.require_workspace_member(channel.workspace_id)
            _ensure_public_channel_members(db, channel)
            member = db.scalar(
                select(ChatMember).where(
                    ChatMember.channel_id == channel_id, ChatMember.user_id == perms.user.id
                )
            )
        if not member:
            raise HTTPException(status_code=404, detail="Channel not found")
    return channel, member


def _attachments_by_message(
    db: Session, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ChatAttachmentOut]]:
    if not message_ids:
        return {}
    rows = db.scalars(
        select(ChatAttachment)
        .where(ChatAttachment.message_id.in_(message_ids), ChatAttachment.deleted_at.is_(None))
        .order_by(ChatAttachment.created_at)
    ).all()
    out: dict[uuid.UUID, list[ChatAttachmentOut]] = {}
    for a in rows:
        if a.message_id is not None:
            out.setdefault(a.message_id, []).append(ChatAttachmentOut.model_validate(a))
    return out


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
    # Backfill the default general channel for workspaces created before it existed.
    ensure_general_channel(db, workspace_id, perms.user.id)
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
    sync_public_channel_members(db, workspace_id)
    db.commit()
    return [_channel_out(db, c, perms.user.id) for c in channels]


@router.post("/workspaces/{workspace_id}/channels", response_model=ChannelOut, status_code=201)
def create_channel(
    workspace_id: uuid.UUID,
    body: ChannelCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    # Channels are workspace structure: only workspace admins / org owners create them
    perms.require_workspace_admin(workspace_id)
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
    member_ids = valid_member_ids if not body.is_private else set(body.member_ids)
    for uid in member_ids:
        if uid != perms.user.id and uid in valid_member_ids:
            db.add(ChatMember(channel_id=channel.id, user_id=uid, role="member"))
    db.commit()
    emit(
        "channel.created",
        [f"workspace:{workspace_id}"],
        payload={"channel_id": str(channel.id), "name": channel.name, "actor_id": str(perms.user.id)},
        workspace_id=workspace_id,
    )
    return _channel_out(db, channel, perms.user.id)


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
def update_channel(
    channel_id: uuid.UUID,
    body: ChannelUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel, member = _require_channel_member(db, perms, channel_id)
    # The general channel's settings may only be changed by workspace admins / org leaders,
    # never by a channel-level admin who is merely a space/project admin.
    if channel.is_general or member.role != "admin":
        perms.require_workspace_admin(channel.workspace_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(channel, field, value)
    db.commit()
    emit(
        "channel.updated",
        [f"workspace:{channel.workspace_id}"],
        payload={"channel_id": str(channel.id), "actor_id": str(perms.user.id)},
        workspace_id=channel.workspace_id,
    )
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
    emit(
        "channel.deleted",
        [f"workspace:{channel.workspace_id}"],
        payload={"channel_id": str(channel.id), "actor_id": str(perms.user.id)},
        workspace_id=channel.workspace_id,
    )
    return Message(detail="Channel deleted")


@router.get("/channels/{channel_id}/members", response_model=list[ChatMemberOut])
def list_channel_members(
    channel_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel, _member = _require_channel_member(db, perms, channel_id)
    if not channel.is_private:
        _ensure_public_channel_members(db, channel)
        db.commit()
    org_owner_ids = _org_owner_ids(db, channel.workspace_id)
    workspace_roles = _workspace_member_roles(db, channel.workspace_id)
    members = db.scalars(
        select(ChatMember).where(ChatMember.channel_id == channel_id)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    result = []
    for m in members:
        out = ChatMemberOut.model_validate(m)
        out.role = _effective_chat_role(
            m.user_id,
            m.role,
            workspace_roles.get(m.user_id),
            org_owner_ids,
        )
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
    if member.role != "admin":
        perms.require_workspace_admin(channel.workspace_id)
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
    if added:
        emit(
            "channel.members.updated",
            [f"workspace:{channel.workspace_id}", f"channel:{channel_id}"],
            payload={"channel_id": str(channel_id), "actor_id": str(perms.user.id)},
            workspace_id=channel.workspace_id,
        )
    return Message(detail=f"{added} member(s) added")


@router.delete("/channels/{channel_id}/members/{member_user_id}", response_model=Message)
def remove_channel_member(
    channel_id: uuid.UUID,
    member_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel, member = _require_channel_member(db, perms, channel_id)
    if channel.is_general:
        raise HTTPException(
            status_code=400,
            detail="The general channel includes every workspace member and can't have members removed",
        )
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
    emit(
        "channel.members.updated",
        [f"workspace:{channel.workspace_id}", f"channel:{channel_id}"],
        payload={"channel_id": str(channel_id), "actor_id": str(perms.user.id)},
        workspace_id=channel.workspace_id,
    )
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
    attachments = _attachments_by_message(db, [m.id for m in rows])
    items = []
    for m in rows:
        out = MessageOut.model_validate(m)
        out.author = briefs.get(m.author_id)
        out.attachments = attachments.get(m.id, [])
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
    if not body.body.strip() and not body.attachment_ids:
        raise HTTPException(status_code=400, detail="Message needs text or an attachment")
    if body.parent_message_id:
        parent = db.get(ChatMessage, body.parent_message_id)
        if not parent or parent.channel_id != channel_id:
            raise HTTPException(status_code=400, detail="Parent message not found")

    # Attachments must be the sender's own unbound uploads into this channel.
    pending_attachments: list[ChatAttachment] = []
    for attachment_id in dict.fromkeys(body.attachment_ids):
        attachment = db.get(ChatAttachment, attachment_id)
        if (
            not attachment
            or attachment.deleted_at is not None
            or attachment.channel_id != channel_id
            or attachment.uploaded_by != perms.user.id
            or attachment.message_id is not None
        ):
            raise HTTPException(status_code=400, detail="Attachment not found")
        pending_attachments.append(attachment)

    if body.client_message_id:
        existing = db.scalar(
            select(ChatMessage).where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.client_message_id == body.client_message_id,
            )
        )
        if existing:
            author = user_brief(db, existing.author_id)
            out = MessageOut.model_validate(existing)
            out.author = author
            out.attachments = _attachments_by_message(db, [existing.id]).get(existing.id, [])
            return out

    message = ChatMessage(
        channel_id=channel_id,
        author_id=perms.user.id,
        parent_message_id=body.parent_message_id,
        body=body.body,
        client_message_id=body.client_message_id,
    )
    db.add(message)
    db.flush()
    for attachment in pending_attachments:
        attachment.message_id = message.id

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
    db.commit()
    # Emit only after commit so receivers refetch committed data
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
            "attachment_count": len(pending_attachments),
        },
        workspace_id=channel.workspace_id,
    )
    out = MessageOut.model_validate(message)
    out.author = author
    out.attachments = [ChatAttachmentOut.model_validate(a) for a in pending_attachments]
    return out


@router.post("/channels/{channel_id}/attachments", response_model=ChatAttachmentOut, status_code=201)
@limiter.limit("30/minute", key_func=upload_rate_key)
async def upload_chat_attachment(
    request: Request,
    channel_id: uuid.UUID,
    file: UploadFile,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Upload a file into a channel. It stays unbound until a message send claims it."""
    guard_upload_request(request, max_attachment_bytes())
    _require_channel_member(db, perms, channel_id)

    content = await read_bounded_upload(file, max_attachment_bytes())
    validate_upload(file, content)
    key = build_key(channel_id, file.filename or "file")
    get_storage().save(key, content)

    attachment = ChatAttachment(
        channel_id=channel_id,
        uploaded_by=perms.user.id,
        file_name=(file.filename or "file")[:300],
        storage_key=key,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
    )
    db.add(attachment)
    db.commit()
    return ChatAttachmentOut.model_validate(attachment)


def _load_chat_attachment_or_404(db: Session, attachment_id: uuid.UUID) -> ChatAttachment:
    attachment = db.get(ChatAttachment, attachment_id)
    if not attachment or attachment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return attachment


@router.delete("/chat-attachments/{attachment_id}", response_model=Message)
def delete_chat_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Remove a pending (not yet sent) upload — only the uploader, only while unbound."""
    attachment = _load_chat_attachment_or_404(db, attachment_id)
    if attachment.uploaded_by != perms.user.id or attachment.message_id is not None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    attachment.deleted_at = datetime.now(timezone.utc)
    get_storage().delete(attachment.storage_key)
    db.commit()
    return Message(detail="Attachment removed")


@router.get("/chat-attachments/{attachment_id}/download")
def download_chat_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    attachment = _load_chat_attachment_or_404(db, attachment_id)
    _require_channel_member(db, perms, attachment.channel_id)
    content = get_storage().read(attachment.storage_key)
    safe_name = attachment.file_name.replace('"', "")
    media_type = safe_download_media_type(attachment.file_name, attachment.mime_type, content)
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


def _load_own_channel_message(
    db: Session, perms: PermissionService, channel_id: uuid.UUID, message_id: uuid.UUID
) -> tuple[ChatChannel, ChatMember, ChatMessage]:
    channel, member = _require_channel_member(db, perms, channel_id)
    message = db.get(ChatMessage, message_id)
    if not message or message.deleted_at is not None or message.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Message not found")
    return channel, member, message


@router.patch("/channels/{channel_id}/messages/{message_id}", response_model=MessageOut)
def edit_message(
    channel_id: uuid.UUID,
    message_id: uuid.UUID,
    body: MessageUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    channel, _member, message = _load_own_channel_message(db, perms, channel_id, message_id)
    if message.author_id != perms.user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")

    # Notify only people newly mentioned by the edit — never re-ping earlier targets.
    channel_member_ids = set(
        db.scalars(select(ChatMember.user_id).where(ChatMember.channel_id == channel_id)).all()
    )
    previously_mentioned = set(extract_mentioned_user_ids(message.body))
    if mentions_everyone(message.body):
        previously_mentioned = channel_member_ids

    message.body = body.body
    message.edited_at = datetime.now(timezone.utc)
    db.flush()
    create_mentions(
        db,
        body=body.body,
        author=perms.user,
        allowed_user_ids=channel_member_ids - previously_mentioned,
        chat_message_id=message.id,
        context_label=f"#{channel.name}",
        url=f"{settings.FRONTEND_URL}/app/chat?channel={channel_id}",
        workspace_id=channel.workspace_id,
        project_id=channel.project_id,
    )
    db.commit()
    emit(
        "chat.message.updated",
        [f"channel:{channel_id}"],
        payload={"message_id": str(message.id), "channel_id": str(channel_id), "actor_id": str(perms.user.id)},
        workspace_id=channel.workspace_id,
    )
    out = MessageOut.model_validate(message)
    out.author = user_brief(db, message.author_id)
    out.attachments = _attachments_by_message(db, [message.id]).get(message.id, [])
    return out


@router.delete("/channels/{channel_id}/messages/{message_id}", response_model=Message)
def delete_message(
    channel_id: uuid.UUID,
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Author may delete their own message; channel admins / workspace admins any message."""
    channel, member, message = _load_own_channel_message(db, perms, channel_id, message_id)
    if message.author_id != perms.user.id and member.role != "admin":
        perms.require_workspace_admin(channel.workspace_id)

    now = datetime.now(timezone.utc)
    message.deleted_at = now
    attachments = db.scalars(
        select(ChatAttachment).where(
            ChatAttachment.message_id == message_id, ChatAttachment.deleted_at.is_(None)
        )
    ).all()
    for attachment in attachments:
        attachment.deleted_at = now
        get_storage().delete(attachment.storage_key)
    db.commit()
    emit(
        "chat.message.deleted",
        [f"channel:{channel_id}"],
        payload={"message_id": str(message_id), "channel_id": str(channel_id), "actor_id": str(perms.user.id)},
        workspace_id=channel.workspace_id,
    )
    return Message(detail="Message deleted")


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
    db.commit()
    emit(
        "chat.read",
        [f"channel:{channel_id}"],
        payload={"channel_id": str(channel_id), "user_id": str(perms.user.id),
                 "message_id": str(body.message_id)},
    )
    return Message(detail="Marked as read")
