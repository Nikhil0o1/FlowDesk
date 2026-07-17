"""Sprint SM delegate, standup blocker resolution."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "n1o2p3q4r5s6"
down_revision = "m0n1o2p3q4r5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sprints",
        sa.Column("delegate_scrum_master_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_sprints_delegate_scrum_master_id_users",
        "sprints",
        "users",
        ["delegate_scrum_master_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "standup_updates",
        sa.Column("blocker_resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "standup_updates",
        sa.Column("blocker_resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_standup_updates_blocker_resolved_by_users",
        "standup_updates",
        "users",
        ["blocker_resolved_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_standup_updates_blocker_resolved_by_users", "standup_updates", type_="foreignkey")
    op.drop_column("standup_updates", "blocker_resolved_by")
    op.drop_column("standup_updates", "blocker_resolved_at")
    op.drop_constraint("fk_sprints_delegate_scrum_master_id_users", "sprints", type_="foreignkey")
    op.drop_column("sprints", "delegate_scrum_master_id")
