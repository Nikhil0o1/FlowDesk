"""task planner calendar sync fields

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-12 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('planned_start_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tasks', sa.Column('planned_end_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tasks', sa.Column('google_calendar_event_id', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'google_calendar_event_id')
    op.drop_column('tasks', 'planned_end_at')
    op.drop_column('tasks', 'planned_start_at')
