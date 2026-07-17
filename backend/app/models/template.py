import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin

# What a template instantiates. A "project" template recreates one project
# (statuses, custom fields, lists, optionally tasks); a "space" template
# recreates a space and all of its projects.
TEMPLATE_KINDS = ("project", "space")

# Who can see / apply a saved template.
#   workspace -> any workspace member
#   admins    -> workspace admins (and the creator)
#   private   -> only the creator
TEMPLATE_VISIBILITY = ("workspace", "admins", "private")


class WorkspaceTemplate(Base, UUIDPkMixin, TimestampMixin):
    """A reusable structural snapshot of a Space or Project, saved within a workspace.

    The structure lives in ``payload`` (a JSON snapshot); applying a template
    rebuilds the live objects from it. Inspired by ClickUp's Template Center."""

    __tablename__ = "workspace_templates"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Denormalized for org-scoped audit and cross-workspace admin queries.
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), default="project", nullable=False)  # project | space
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(20), default="#9B59B6", nullable=False)
    icon: Mapped[str | None] = mapped_column(String(40))
    tags: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    visibility: Mapped[str] = mapped_column(String(20), default="workspace", nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
