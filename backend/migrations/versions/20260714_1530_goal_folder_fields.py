"""goal folder description and color

Revision ID: goalfolder01
Revises: goalcolor01
Create Date: 2026-07-14 15:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "goalfolder01"
down_revision: Union[str, Sequence[str], None] = "goalcolor01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("goal_folders", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("goal_folders", sa.Column("color", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("goal_folders", "color")
    op.drop_column("goal_folders", "description")
