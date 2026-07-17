import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPkMixin


class Whiteboard(Base, UUIDPkMixin, TimestampMixin, SoftDeleteMixin):
    """Free-form canvas backed by Excalidraw.

    content is an Excalidraw scene: {"elements": [...], "appState": {...}, "files": {...}}
    (files holds embedded images keyed by file id).
    """

    __tablename__ = "whiteboards"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Board privacy is scoped to a project: only that project's members may see/open it.
    # Nullable for legacy boards created before project-scoping (visible to creator + workspace admins only).
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
