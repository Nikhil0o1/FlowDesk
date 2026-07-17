"""inbox extensions — snooze, clear, preferences

Revision ID: inboxext01
Revises: chatdmprefs01
Create Date: 2026-07-07 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "inboxext01"
down_revision: str = "chatdmprefs01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "notifications",
        sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_notifications_user_cleared", "notifications", ["user_id", "cleared_at"])
    op.create_index("ix_notifications_user_snoozed", "notifications", ["user_id", "snoozed_until"])

    op.create_table(
        "inbox_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("show_all_tab", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("group_by_date", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_newest_first", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("display_mode", sa.String(20), nullable=False, server_default="fullscreen"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "notification_type_preferences",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(60), nullable=False),
        sa.Column("important", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "type", name="uq_notification_type_pref_user_type"),
    )
    op.create_index(
        "ix_notification_type_pref_user",
        "notification_type_preferences",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_notification_type_pref_user", table_name="notification_type_preferences")
    op.drop_table("notification_type_preferences")
    op.drop_table("inbox_settings")
    op.drop_index("ix_notifications_user_snoozed", table_name="notifications")
    op.drop_index("ix_notifications_user_cleared", table_name="notifications")
    op.drop_column("notifications", "cleared_at")
    op.drop_column("notifications", "snoozed_until")
