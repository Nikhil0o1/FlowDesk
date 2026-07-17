"""task public share options: expiry + search-engine indexing

Adds public_expires_at (auto-expire a public link) and public_searchable
(allow search engines to index the public view) to tasks.

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-06-17 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a8b9c0d1e2f3'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('public_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'tasks',
        sa.Column('public_searchable', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Drop the server_default now that existing rows are backfilled.
    op.alter_column('tasks', 'public_searchable', server_default=None)


def downgrade() -> None:
    op.drop_column('tasks', 'public_searchable')
    op.drop_column('tasks', 'public_expires_at')
