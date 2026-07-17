"""Sprint scope lock, impediment register."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "o2p3q4r5s6t7"
down_revision = "n1o2p3q4r5s6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sprints",
        sa.Column("scope_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "sprint_impediments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sprint_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sprints.id", ondelete="CASCADE"), nullable=False),
        sa.Column("standup_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("standup_updates.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reporter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_sprint_impediments_sprint_id", "sprint_impediments", ["sprint_id"])
    op.create_index("ix_sprint_impediments_status", "sprint_impediments", ["sprint_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_sprint_impediments_status", "sprint_impediments")
    op.drop_index("ix_sprint_impediments_sprint_id", "sprint_impediments")
    op.drop_table("sprint_impediments")
    op.drop_column("sprints", "scope_locked")
