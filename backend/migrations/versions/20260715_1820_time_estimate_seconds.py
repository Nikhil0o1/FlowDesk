"""Rename time_estimate_minutes -> time_estimate_seconds (values * 60).

Revision ID: estimate_sec01
Revises: 8c55bb165226
Create Date: 2026-07-15 18:20:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "estimate_sec01"
down_revision: Union[str, Sequence[str], None] = "8c55bb165226"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tasks
        SET time_estimate_minutes = time_estimate_minutes * 60
        WHERE time_estimate_minutes IS NOT NULL
        """
    )
    op.alter_column(
        "tasks",
        "time_estimate_minutes",
        new_column_name="time_estimate_seconds",
        existing_type=sa.Integer(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "tasks",
        "time_estimate_seconds",
        new_column_name="time_estimate_minutes",
        existing_type=sa.Integer(),
        existing_nullable=True,
    )
    op.execute(
        """
        UPDATE tasks
        SET time_estimate_minutes = CASE
          WHEN time_estimate_minutes IS NULL THEN NULL
          ELSE GREATEST(1, (time_estimate_minutes + 59) / 60)
        END
        WHERE time_estimate_minutes IS NOT NULL
        """
    )
