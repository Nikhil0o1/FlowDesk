"""goal color and folders

Revision ID: goalcolor01
Revises: goalshare01
Create Date: 2026-07-14 15:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "goalcolor01"
down_revision: Union[str, Sequence[str], None] = "goalshare01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goal_folders",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_goal_folders_workspace_id"), "goal_folders", ["workspace_id"], unique=False)

    op.add_column("goals", sa.Column("color", sa.String(length=32), nullable=True))
    op.add_column("goals", sa.Column("folder_id", sa.UUID(), nullable=True))
    op.create_index(op.f("ix_goals_folder_id"), "goals", ["folder_id"], unique=False)
    op.create_foreign_key(
        "fk_goals_folder_id",
        "goals",
        "goal_folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_goals_folder_id", "goals", type_="foreignkey")
    op.drop_index(op.f("ix_goals_folder_id"), table_name="goals")
    op.drop_column("goals", "folder_id")
    op.drop_column("goals", "color")
    op.drop_index(op.f("ix_goal_folders_workspace_id"), table_name="goal_folders")
    op.drop_table("goal_folders")
