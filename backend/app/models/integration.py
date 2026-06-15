import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPkMixin


class GoogleSheetSync(Base, UUIDPkMixin, TimestampMixin):
    """A project whose tasks are continuously mirrored to a Google Sheet.

    The sheet is written with the OAuth connection of the user who enabled the
    sync; if that connection is removed the sync is deactivated by the cron job.

    sync_mode "export" mirrors FlowDesk -> sheet only. "two_way" additionally
    reads the sheet before each rewrite: cells edited in the sheet are applied
    to the matching tasks, and rows added without a Ref become new tasks.
    `snapshot` holds the rows as last exported (keyed by ref) so only cells
    that actually changed in the sheet are applied.
    """

    __tablename__ = "google_sheet_syncs"
    __table_args__ = (UniqueConstraint("project_id", name="uq_sheet_sync_project"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendar_connections.id", ondelete="CASCADE"), nullable=False
    )
    spreadsheet_id: Mapped[str] = mapped_column(String(120), nullable=False)
    spreadsheet_url: Mapped[str] = mapped_column(String(500), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sync_mode: Mapped[str] = mapped_column(String(20), default="export", nullable=False)
    snapshot: Mapped[dict | None] = mapped_column(JSONB)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
