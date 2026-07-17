"""Add display_order for goal card reordering.

Revision ID: goalorder01
Revises: goalowners01
Create Date: 2026-07-14 17:45:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "goalorder01"
down_revision: Union[str, Sequence[str], None] = "goalowners01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "goals",
        sa.Column("display_order", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index(op.f("ix_goals_display_order"), "goals", ["display_order"])
    # Backfill: order by created_at within each workspace (+ folder)
    op.execute(
        """
        WITH ordered AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY workspace_id, folder_id
                   ORDER BY created_at ASC
                 ) - 1 AS rn
          FROM goals
          WHERE deleted_at IS NULL
        )
        UPDATE goals g
        SET display_order = ordered.rn
        FROM ordered
        WHERE g.id = ordered.id
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_goals_display_order"), table_name="goals")
    op.drop_column("goals", "display_order")
