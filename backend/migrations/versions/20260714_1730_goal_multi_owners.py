"""Goal and target multi-owners join tables.

Revision ID: goalowners01
Revises: goaltargetsprint01
Create Date: 2026-07-14 17:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "goalowners01"
down_revision: Union[str, Sequence[str], None] = "goaltargetsprint01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goal_owners",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("goal_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("goal_id", "user_id", name="uq_goal_owner"),
    )
    op.create_index(op.f("ix_goal_owners_goal_id"), "goal_owners", ["goal_id"])
    op.create_index(op.f("ix_goal_owners_user_id"), "goal_owners", ["user_id"])

    op.create_table(
        "goal_target_owners",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("goal_target_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["goal_target_id"], ["goal_targets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("goal_target_id", "user_id", name="uq_goal_target_owner"),
    )
    op.create_index(op.f("ix_goal_target_owners_goal_target_id"), "goal_target_owners", ["goal_target_id"])
    op.create_index(op.f("ix_goal_target_owners_user_id"), "goal_target_owners", ["user_id"])

    # Backfill from existing single owner_id columns
    op.execute(
        """
        INSERT INTO goal_owners (id, goal_id, user_id, created_by, created_at, updated_at)
        SELECT gen_random_uuid(), g.id, g.owner_id, g.created_by, now(), now()
        FROM goals g
        WHERE g.deleted_at IS NULL
          AND g.owner_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM goal_owners go WHERE go.goal_id = g.id AND go.user_id = g.owner_id
          )
        """
    )
    op.execute(
        """
        INSERT INTO goal_target_owners (id, goal_target_id, user_id, created_by, created_at, updated_at)
        SELECT gen_random_uuid(), t.id, t.owner_id, NULL, now(), now()
        FROM goal_targets t
        WHERE t.owner_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM goal_target_owners gto
            WHERE gto.goal_target_id = t.id AND gto.user_id = t.owner_id
          )
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_goal_target_owners_user_id"), table_name="goal_target_owners")
    op.drop_index(op.f("ix_goal_target_owners_goal_target_id"), table_name="goal_target_owners")
    op.drop_table("goal_target_owners")
    op.drop_index(op.f("ix_goal_owners_user_id"), table_name="goal_owners")
    op.drop_index(op.f("ix_goal_owners_goal_id"), table_name="goal_owners")
    op.drop_table("goal_owners")
