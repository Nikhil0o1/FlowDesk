"""task followers for auto-follow inbox setting

Revision ID: taskfollow01
Revises: inboxdeliv01
Create Date: 2026-07-07 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "taskfollow01"
down_revision: str = "inboxdeliv01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_followers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("task_id", "user_id", name="uq_task_follower"),
    )
    op.create_index("ix_task_followers_task_id", "task_followers", ["task_id"])
    op.create_index("ix_task_followers_user_id", "task_followers", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_task_followers_user_id", table_name="task_followers")
    op.drop_index("ix_task_followers_task_id", table_name="task_followers")
    op.drop_table("task_followers")
