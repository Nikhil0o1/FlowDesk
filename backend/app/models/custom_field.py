import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin

CUSTOM_FIELD_TYPES = ("text", "number", "date", "select", "checkbox")


class CustomFieldDefinition(Base, UUIDPkMixin, TimestampMixin):
    """A custom field defined on a project; applies to all of its tasks."""

    __tablename__ = "custom_field_definitions"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    field_type: Mapped[str] = mapped_column(String(20), default="text", nullable=False)
    options: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)  # for "select"
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class CustomFieldValue(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "custom_field_values"
    __table_args__ = (UniqueConstraint("field_id", "task_id", name="uq_custom_field_value"),)

    field_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("custom_field_definitions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    value: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)  # {"v": <text|number|date|bool|option>}
