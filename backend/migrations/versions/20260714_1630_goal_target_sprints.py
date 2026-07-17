"""Link sprints (lists) to goal targets for progress tracking.

Revision ID: goaltargetsprint01
Revises: goalfolder05
Create Date: 2026-07-14 16:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "goaltargetsprint01"
down_revision: Union[str, Sequence[str], None] = "goalfolder05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goal_target_sprints",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("goal_target_id", sa.UUID(), nullable=False),
        sa.Column("sprint_id", sa.UUID(), nullable=False),
        sa.Column("added_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["added_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["goal_target_id"], ["goal_targets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sprint_id"], ["sprints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("goal_target_id", "sprint_id", name="uq_goal_target_sprint"),
    )
    op.create_index(op.f("ix_goal_target_sprints_goal_target_id"), "goal_target_sprints", ["goal_target_id"])
    op.create_index(op.f("ix_goal_target_sprints_sprint_id"), "goal_target_sprints", ["sprint_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_goal_target_sprints_sprint_id"), table_name="goal_target_sprints")
    op.drop_index(op.f("ix_goal_target_sprints_goal_target_id"), table_name="goal_target_sprints")
    op.drop_table("goal_target_sprints")
