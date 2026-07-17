"""presence analytics tables (user_presence, user_sessions, presence_events)

Revision ID: presenceanalytics01
Revises: wbprojgench01
Create Date: 2026-07-03 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "presenceanalytics01"
down_revision: str = "wbprojgench01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_presence",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="offline"),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_user_presence_user_id", "user_presence", ["user_id"], unique=True)

    op.create_table(
        "user_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("login_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("logout_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_activity", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_duration", sa.Integer(), nullable=True),
        sa.Column("device", sa.String(120), nullable=True),
        sa.Column("browser", sa.String(120), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_user_login", "user_sessions", ["user_id", "login_time"])
    op.create_index("ix_user_sessions_open", "user_sessions", ["user_id", "logout_time"])

    op.create_table(
        "presence_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(30), nullable=False),
        sa.Column("old_status", sa.String(20), nullable=True),
        sa.Column("new_status", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_presence_events_user_id", "presence_events", ["user_id"])
    op.create_index("ix_presence_events_created_at", "presence_events", ["created_at"])
    op.create_index("ix_presence_events_user_created", "presence_events", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_presence_events_user_created", table_name="presence_events")
    op.drop_index("ix_presence_events_created_at", table_name="presence_events")
    op.drop_index("ix_presence_events_user_id", table_name="presence_events")
    op.drop_table("presence_events")

    op.drop_index("ix_user_sessions_open", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_login", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")

    op.drop_index("ix_user_presence_user_id", table_name="user_presence")
    op.drop_table("user_presence")
