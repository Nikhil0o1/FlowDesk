import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPkMixin

TASK_PRIORITIES = ("urgent", "high", "normal", "low")
TASK_TYPES = ("task", "bug", "story", "epic")
STATUS_CATEGORIES = ("todo", "in_progress", "done", "cancelled")


class CustomStatus(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "custom_statuses"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#87909E", nullable=False)
    category: Mapped[str] = mapped_column(String(20), default="todo", nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Task(Base, UUIDPkMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("project_id", "number", name="uq_task_number_per_project"),
        Index("ix_tasks_due_date", "due_date"),
        Index("ix_tasks_title", "title"),
        Index("ix_tasks_labels", "labels", postgresql_using="gin"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    list_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_lists.id", ondelete="SET NULL"), index=True
    )
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)  # per-project sequence (KEY-123)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str | None] = mapped_column(String(20))  # urgent | high | normal | low
    status_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("custom_statuses.id", ondelete="SET NULL"), index=True
    )
    task_type: Mapped[str] = mapped_column(String(20), default="task", nullable=False)
    start_date: Mapped[datetime | None] = mapped_column(Date)
    due_date: Mapped[datetime | None] = mapped_column(Date)
    story_points: Mapped[int | None] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    labels: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    github_issue_number: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    github_issue_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class TaskAssignee(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "task_assignees"
    __table_args__ = (UniqueConstraint("task_id", "user_id", name="uq_task_assignee"),)

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class TaskDependency(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "task_dependencies"
    __table_args__ = (
        UniqueConstraint("task_id", "depends_on_task_id", name="uq_task_dependency"),
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    depends_on_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class TaskAttachment(Base, UUIDPkMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "task_attachments"

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    file_name: Mapped[str] = mapped_column(String(300), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)


class RecurringTask(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "recurring_tasks"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    list_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_lists.id", ondelete="SET NULL")
    )
    source_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL")
    )
    frequency: Mapped[str] = mapped_column(String(20), nullable=False)  # daily | weekly | monthly
    interval: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    template: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    next_occurrence_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
