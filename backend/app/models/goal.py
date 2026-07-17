import secrets
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPkMixin

GOAL_STATUSES = ("draft", "active", "completed", "archived")
GOAL_TARGET_TYPES = ("tasks", "number", "currency", "true_false")
GOAL_SHARE_ROLES = ("editor", "viewer")


def new_goal_share_token() -> str:
    return secrets.token_urlsafe(24)


class Goal(Base, UUIDPkMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "goals"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    progress: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"), nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    # False = shared with workspace (people who can access Goals); True = private ACL only
    is_private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    color: Mapped[str | None] = mapped_column(String(32))
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goal_folders.id", ondelete="SET NULL"), index=True
    )
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class GoalFolder(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "goal_folders"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(32))
    is_private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class GoalFolderShareMember(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "goal_folder_share_members"
    __table_args__ = (UniqueConstraint("folder_id", "user_id", name="uq_goal_folder_share_member"),)

    folder_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goal_folders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), default="viewer", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class GoalTarget(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "goal_targets"

    goal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goals.id", ondelete="CASCADE"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    target_type: Mapped[str] = mapped_column(String(20), default="tasks", nullable=False)
    # Used by number / currency targets
    start_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    target_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    current_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    # Used by true_false targets
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    progress: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class GoalTargetTask(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "goal_target_tasks"
    __table_args__ = (
        UniqueConstraint("goal_target_id", "task_id", name="uq_goal_target_task"),
        UniqueConstraint("task_id", name="uq_goal_target_task_global"),
    )

    goal_target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goal_targets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class GoalTargetSprint(Base, UUIDPkMixin, TimestampMixin):
    """Sprint (list) linked to a tasks-type goal target — its tasks drive progress."""

    __tablename__ = "goal_target_sprints"
    __table_args__ = (
        UniqueConstraint("goal_target_id", "sprint_id", name="uq_goal_target_sprint"),
    )

    goal_target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goal_targets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sprint_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sprints.id", ondelete="CASCADE"), index=True, nullable=False
    )
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class GoalShareMember(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "goal_share_members"
    __table_args__ = (UniqueConstraint("goal_id", "user_id", name="uq_goal_share_member"),)

    goal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goals.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), default="viewer", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class GoalOwner(Base, UUIDPkMixin, TimestampMixin):
    """Co-owners of a goal. Primary owner also lives on goals.owner_id."""

    __tablename__ = "goal_owners"
    __table_args__ = (UniqueConstraint("goal_id", "user_id", name="uq_goal_owner"),)

    goal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goals.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class GoalTargetOwner(Base, UUIDPkMixin, TimestampMixin):
    """Co-owners of a goal target. Primary owner also lives on goal_targets.owner_id."""

    __tablename__ = "goal_target_owners"
    __table_args__ = (UniqueConstraint("goal_target_id", "user_id", name="uq_goal_target_owner"),)

    goal_target_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("goal_targets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
