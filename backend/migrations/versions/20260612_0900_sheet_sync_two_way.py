"""sheet sync: two-way mode + snapshot

Also merges the two parallel migration heads (team member roles and the
GitHub integration chain) back into a single head.

Revision ID: f1a2b3c4d5e6
Revises: b7c8d9e0f1a2, e5f6a7b8c9d0
Create Date: 2026-06-12 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = ('b7c8d9e0f1a2', 'e5f6a7b8c9d0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'google_sheet_syncs',
        sa.Column('sync_mode', sa.String(length=20), nullable=False, server_default='export'),
    )
    op.add_column('google_sheet_syncs', sa.Column('snapshot', JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('google_sheet_syncs', 'snapshot')
    op.drop_column('google_sheet_syncs', 'sync_mode')
