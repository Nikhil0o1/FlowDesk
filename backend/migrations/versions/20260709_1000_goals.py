"""task-based goals schema

Revision ID: goals20260709
Revises: chatfavdefault01
Create Date: 2026-07-09 10:00:00.000000

Adds goals, goal_targets, and goal_target_tasks. Each task may be linked to at
most one goal (global unique on goal_target_tasks.task_id).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "goals20260709"
down_revision: Union[str, Sequence[str], None] = "chatfavdefault01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("progress", sa.Numeric(precision=5, scale=2), server_default="0", nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_goals_created_by"), "goals", ["created_by"], unique=False)
    op.create_index(op.f("ix_goals_deleted_at"), "goals", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_goals_owner_id"), "goals", ["owner_id"], unique=False)
    op.create_index(op.f("ix_goals_workspace_id"), "goals", ["workspace_id"], unique=False)

    op.create_table(
        "goal_targets",
        sa.Column("goal_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("progress", sa.Numeric(precision=5, scale=2), server_default="0", nullable=False),
        sa.Column("display_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_goal_targets_goal_id"), "goal_targets", ["goal_id"], unique=False)

    op.create_table(
        "goal_target_tasks",
        sa.Column("goal_target_id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("added_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["added_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["goal_target_id"], ["goal_targets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("goal_target_id", "task_id", name="uq_goal_target_task"),
        sa.UniqueConstraint("task_id", name="uq_goal_target_task_global"),
    )
    op.create_index(op.f("ix_goal_target_tasks_goal_target_id"), "goal_target_tasks", ["goal_target_id"], unique=False)
    op.create_index(op.f("ix_goal_target_tasks_task_id"), "goal_target_tasks", ["task_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_goal_target_tasks_task_id"), table_name="goal_target_tasks")
    op.drop_index(op.f("ix_goal_target_tasks_goal_target_id"), table_name="goal_target_tasks")
    op.drop_table("goal_target_tasks")
    op.drop_index(op.f("ix_goal_targets_goal_id"), table_name="goal_targets")
    op.drop_table("goal_targets")
    op.drop_index(op.f("ix_goals_workspace_id"), table_name="goals")
    op.drop_index(op.f("ix_goals_owner_id"), table_name="goals")
    op.drop_index(op.f("ix_goals_deleted_at"), table_name="goals")
    op.drop_index(op.f("ix_goals_created_by"), table_name="goals")
    op.drop_table("goals")
