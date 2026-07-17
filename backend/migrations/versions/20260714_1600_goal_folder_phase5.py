"""Phase 5 goal folder archive, share ACL

Revision ID: goalfolder05
Revises: goalfolder01
Create Date: 2026-07-14 16:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "goalfolder05"
down_revision: Union[str, Sequence[str], None] = "goalfolder01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "goal_folders",
        sa.Column("is_private", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "goal_folders",
        sa.Column("is_archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column("goal_folders", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "goal_folder_share_members",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("folder_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["folder_id"], ["goal_folders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("folder_id", "user_id", name="uq_goal_folder_share_member"),
    )
    op.create_index(op.f("ix_goal_folder_share_members_folder_id"), "goal_folder_share_members", ["folder_id"])
    op.create_index(op.f("ix_goal_folder_share_members_user_id"), "goal_folder_share_members", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_goal_folder_share_members_user_id"), table_name="goal_folder_share_members")
    op.drop_index(op.f("ix_goal_folder_share_members_folder_id"), table_name="goal_folder_share_members")
    op.drop_table("goal_folder_share_members")
    op.drop_column("goal_folders", "archived_at")
    op.drop_column("goal_folders", "is_archived")
    op.drop_column("goal_folders", "is_private")
