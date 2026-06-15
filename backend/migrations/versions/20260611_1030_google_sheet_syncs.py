"""google sheet syncs

Revision ID: a1f2e3d4c5b6
Revises: bee0840b1daf
Create Date: 2026-06-11 10:30:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a1f2e3d4c5b6'
down_revision: Union[str, None] = 'bee0840b1daf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'google_sheet_syncs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('connection_id', sa.UUID(), nullable=False),
        sa.Column('spreadsheet_id', sa.String(length=120), nullable=False),
        sa.Column('spreadsheet_url', sa.String(length=500), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['connection_id'], ['calendar_connections.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', name='uq_sheet_sync_project'),
    )
    op.create_index(op.f('ix_google_sheet_syncs_project_id'), 'google_sheet_syncs', ['project_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_google_sheet_syncs_project_id'), table_name='google_sheet_syncs')
    op.drop_table('google_sheet_syncs')
