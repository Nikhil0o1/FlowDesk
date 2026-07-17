"""scope whiteboards to a project and flag the workspace general channel

Revision ID: wbprojgench01
Revises: p3q4r5s6t7u8
Create Date: 2026-07-02 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "wbprojgench01"
down_revision: str = "p3q4r5s6t7u8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Whiteboards become project-scoped for privacy. Nullable so existing boards
    # (created before scoping) survive as legacy workspace-level boards.
    op.add_column(
        "whiteboards",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_whiteboards_project_id", "whiteboards", ["project_id"])
    op.create_foreign_key(
        "fk_whiteboards_project_id", "whiteboards", "projects", ["project_id"], ["id"], ondelete="CASCADE"
    )

    # Flag the default per-workspace "general" channel so its settings/deletion can be
    # restricted to workspace admins / org leaders regardless of channel-level role.
    op.add_column(
        "chat_channels",
        sa.Column("is_general", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Backfill: existing default channels named "general" become the protected general channel.
    op.execute("UPDATE chat_channels SET is_general = true WHERE lower(name) = 'general'")


def downgrade() -> None:
    op.drop_column("chat_channels", "is_general")
    op.drop_constraint("fk_whiteboards_project_id", "whiteboards", type_="foreignkey")
    op.drop_index("ix_whiteboards_project_id", table_name="whiteboards")
    op.drop_column("whiteboards", "project_id")
