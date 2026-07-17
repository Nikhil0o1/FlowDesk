"""Drop delegate scrum master and scope lock from sprints."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "q4r5s6t7u8v9"
down_revision = "p3q4r5s6t7u8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("fk_sprints_delegate_scrum_master_id_users", "sprints", type_="foreignkey")
    op.drop_column("sprints", "delegate_scrum_master_id")
    op.drop_column("sprints", "scope_locked")


def downgrade() -> None:
    op.add_column(
        "sprints",
        sa.Column("scope_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
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
