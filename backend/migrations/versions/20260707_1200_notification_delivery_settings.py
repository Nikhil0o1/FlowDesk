"""notification delivery preferences on inbox_settings

Revision ID: inboxdeliv01
Revises: inboxext01
Create Date: 2026-07-07 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision: str = "inboxdeliv01"
down_revision: str = "inboxext01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inbox_settings",
        sa.Column("email_notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "inbox_settings",
        sa.Column("browser_notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "inbox_settings",
        sa.Column("auto_follow_tasks", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("inbox_settings", "auto_follow_tasks")
    op.drop_column("inbox_settings", "browser_notifications_enabled")
    op.drop_column("inbox_settings", "email_notifications_enabled")
