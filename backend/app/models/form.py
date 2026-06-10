import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPkMixin

FORM_FIELD_TYPES = ("text", "textarea", "select", "date", "email")


class Form(Base, UUIDPkMixin, TimestampMixin, SoftDeleteMixin):
    """Public intake form. Submissions create tasks in the linked project.

    fields = [{"id", "type", "label", "required", "options"?}, ...]
    The first field is always the task name.
    """

    __tablename__ = "forms"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    fields: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    public_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )


class FormSubmission(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "form_submissions"

    form_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("forms.id", ondelete="CASCADE"), index=True, nullable=False
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL")
    )
    data: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    submitter_email: Mapped[str | None] = mapped_column(String(320))
