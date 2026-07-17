"""Add sprint retrospectives and items.

Revision ID: sprintretro01
Revises: estimate_sec01
Create Date: 2026-07-15 18:45:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "sprintretro01"
down_revision: Union[str, Sequence[str], None] = "estimate_sec01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sprint_retrospectives",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sprint_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stage_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["sprint_id"], ["sprints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sprint_id", name="uq_sprint_retrospective"),
    )
    op.create_index(op.f("ix_sprint_retrospectives_sprint_id"), "sprint_retrospectives", ["sprint_id"])

    op.create_table(
        "sprint_retrospective_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("retrospective_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_done", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("assignee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["retrospective_id"], ["sprint_retrospectives.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_sprint_retrospective_items_retrospective_id"),
        "sprint_retrospective_items",
        ["retrospective_id"],
    )
    op.create_index(
        op.f("ix_sprint_retrospective_items_author_id"),
        "sprint_retrospective_items",
        ["author_id"],
    )
    op.create_index(
        op.f("ix_sprint_retrospective_items_assignee_id"),
        "sprint_retrospective_items",
        ["assignee_id"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_sprint_retrospective_items_assignee_id"), table_name="sprint_retrospective_items")
    op.drop_index(op.f("ix_sprint_retrospective_items_author_id"), table_name="sprint_retrospective_items")
    op.drop_index(
        op.f("ix_sprint_retrospective_items_retrospective_id"),
        table_name="sprint_retrospective_items",
    )
    op.drop_table("sprint_retrospective_items")
    op.drop_index(op.f("ix_sprint_retrospectives_sprint_id"), table_name="sprint_retrospectives")
    op.drop_table("sprint_retrospectives")
