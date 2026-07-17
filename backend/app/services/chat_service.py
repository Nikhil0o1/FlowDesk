import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.websocket import emit
from app.models.chat import ChatChannel, ChatMember
from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember
from app.models.workspace import Workspace, WorkspaceMember


def public_channel_user_ids(db: Session, workspace_id: uuid.UUID) -> set[uuid.UUID]:
    workspace = db.get(Workspace, workspace_id)
    if not workspace:
        return set()

    ids = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)
        ).all()
    )
    ids |= set(
        db.scalars(
            select(ProjectMember.user_id)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        ).all()
    )
    # Org owners AND org admins belong to every public/general channel in every
    # workspace across the org (they have org-wide access).
    ids |= set(
        db.scalars(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == workspace.organization_id,
                OrganizationMember.role.in_(("owner", "admin")),
            )
        ).all()
    )
    return ids


def ensure_general_channel(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID | None = None
) -> ChatChannel | None:
    """Guarantee every workspace has its default public "general" channel.

    Idempotent and safe to call on every channel list:
    - If a general channel already exists (even soft-deleted, so a deliberate deletion
      is respected), do nothing.
    - Adopt a pre-existing public channel literally named "general" if present.
    - Otherwise create one. Membership (all workspace members) is filled by the
      public-channel sync that runs alongside it.
    """
    existing = db.scalar(
        select(ChatChannel).where(
            ChatChannel.workspace_id == workspace_id,
            ChatChannel.is_general.is_(True),
        )
    )
    if existing is not None:
        return existing
    adopt = db.scalar(
        select(ChatChannel).where(
            ChatChannel.workspace_id == workspace_id,
            ChatChannel.deleted_at.is_(None),
            ChatChannel.is_private.is_(False),
            func.lower(ChatChannel.name) == "general",
        )
    )
    if adopt is not None:
        adopt.is_general = True
        db.flush()
        return adopt
    channel = ChatChannel(
        workspace_id=workspace_id,
        name="general",
        is_general=True,
        is_private=False,
        created_by=actor_id,
    )
    db.add(channel)
    db.flush()
    return channel


def sync_public_channel_members(
    db: Session,
    workspace_id: uuid.UUID,
    user_ids: set[uuid.UUID] | None = None,
) -> list[uuid.UUID]:
    # The session runs with autoflush=False; flush so members added earlier in
    # this request (e.g. the creator's admin row in create_workspace) are visible
    # to the reads below and keep their intended role.
    db.flush()
    allowed_user_ids = public_channel_user_ids(db, workspace_id)
    if user_ids is not None:
        allowed_user_ids &= user_ids
    if not allowed_user_ids:
        return []

    channels = db.scalars(
        select(ChatChannel).where(
            ChatChannel.workspace_id == workspace_id,
            ChatChannel.is_private.is_(False),
            ChatChannel.deleted_at.is_(None),
        )
    ).all()
    changed_channel_ids: list[uuid.UUID] = []
    for channel in channels:
        existing_user_ids = set(
            db.scalars(select(ChatMember.user_id).where(ChatMember.channel_id == channel.id)).all()
        )
        missing_user_ids = allowed_user_ids - existing_user_ids
        if missing_user_ids:
            # ON CONFLICT DO NOTHING: concurrent requests sync the same channel
            # (channel list, invites, workspace create) and must not race each
            # other into a uq_chat_member violation.
            db.execute(
                pg_insert(ChatMember.__table__)
                .values(
                    [
                        {
                            "id": uuid.uuid4(),
                            "channel_id": channel.id,
                            "user_id": user_id,
                            "role": "member",
                        }
                        for user_id in missing_user_ids
                    ]
                )
                .on_conflict_do_nothing(constraint="uq_chat_member")
            )
            changed_channel_ids.append(channel.id)
    return changed_channel_ids


def prune_public_channel_members(
    db: Session,
    workspace_id: uuid.UUID,
    user_ids: set[uuid.UUID],
) -> list[uuid.UUID]:
    """Remove the given users from this workspace's public channels IF they no longer
    qualify for membership — i.e. they are neither a workspace member, a project member
    in this workspace, nor an org owner/admin. Used when an org admin/owner is demoted:
    they stay in general channels of workspaces they actually belong to, and drop out of
    the rest. Private channels and still-qualified users are never touched.
    """
    if not user_ids:
        return []
    # autoflush is off in production: flush so the role/membership change that
    # triggered this prune (e.g. an org-admin demotion earlier in the request)
    # is visible to the qualification check below.
    db.flush()
    still_allowed = public_channel_user_ids(db, workspace_id)
    to_remove = set(user_ids) - still_allowed
    if not to_remove:
        return []

    channels = db.scalars(
        select(ChatChannel).where(
            ChatChannel.workspace_id == workspace_id,
            ChatChannel.is_private.is_(False),
            ChatChannel.deleted_at.is_(None),
        )
    ).all()
    changed_channel_ids: list[uuid.UUID] = []
    for channel in channels:
        rows = db.scalars(
            select(ChatMember).where(
                ChatMember.channel_id == channel.id,
                ChatMember.user_id.in_(to_remove),
            )
        ).all()
        for row in rows:
            db.delete(row)
        if rows:
            changed_channel_ids.append(channel.id)
    if changed_channel_ids:
        db.flush()
    return changed_channel_ids


def emit_public_channel_member_updates(
    workspace_id: uuid.UUID,
    channel_ids: list[uuid.UUID],
    actor_id: uuid.UUID,
) -> None:
    for channel_id in channel_ids:
        emit(
            "channel.members.updated",
            [f"workspace:{workspace_id}", f"channel:{channel_id}"],
            payload={"channel_id": str(channel_id), "actor_id": str(actor_id)},
            workspace_id=workspace_id,
        )
