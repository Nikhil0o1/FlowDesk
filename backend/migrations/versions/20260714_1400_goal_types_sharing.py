"""goal target types and sharing

Revision ID: goalshare01
Revises: mergegoalsmcp01
Create Date: 2026-07-14 14:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "goalshare01"
down_revision: Union[str, Sequence[str], None] = "mergegoalsmcp01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("goals", sa.Column("is_private", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("goals", sa.Column("share_token", sa.String(length=64), nullable=True))
    op.create_index(op.f("ix_goals_share_token"), "goals", ["share_token"], unique=True)

    op.add_column("goal_targets", sa.Column("owner_id", sa.UUID(), nullable=True))
    op.add_column(
        "goal_targets",
        sa.Column("target_type", sa.String(length=20), server_default="tasks", nullable=False),
    )
    op.add_column("goal_targets", sa.Column("start_value", sa.Numeric(precision=18, scale=4), nullable=True))
    op.add_column("goal_targets", sa.Column("target_value", sa.Numeric(precision=18, scale=4), nullable=True))
    op.add_column("goal_targets", sa.Column("current_value", sa.Numeric(precision=18, scale=4), nullable=True))
    op.add_column(
        "goal_targets",
        sa.Column("is_completed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_index(op.f("ix_goal_targets_owner_id"), "goal_targets", ["owner_id"], unique=False)
    op.create_foreign_key("fk_goal_targets_owner_id", "goal_targets", "users", ["owner_id"], ["id"], ondelete="SET NULL")

    op.create_table(
        "goal_share_members",
        sa.Column("goal_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=20), server_default="viewer", nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("goal_id", "user_id", name="uq_goal_share_member"),
    )
    op.create_index(op.f("ix_goal_share_members_goal_id"), "goal_share_members", ["goal_id"], unique=False)
    op.create_index(op.f("ix_goal_share_members_user_id"), "goal_share_members", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_goal_share_members_user_id"), table_name="goal_share_members")
    op.drop_index(op.f("ix_goal_share_members_goal_id"), table_name="goal_share_members")
    op.drop_table("goal_share_members")

    op.drop_constraint("fk_goal_targets_owner_id", "goal_targets", type_="foreignkey")
    op.drop_index(op.f("ix_goal_targets_owner_id"), table_name="goal_targets")
    op.drop_column("goal_targets", "is_completed")
    op.drop_column("goal_targets", "current_value")
    op.drop_column("goal_targets", "target_value")
    op.drop_column("goal_targets", "start_value")
    op.drop_column("goal_targets", "target_type")
    op.drop_column("goal_targets", "owner_id")

    op.drop_index(op.f("ix_goals_share_token"), table_name="goals")
    op.drop_column("goals", "share_token")
    op.drop_column("goals", "is_private")
