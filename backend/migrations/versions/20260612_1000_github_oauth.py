"""github oauth tokens and webhook hook id

Revision ID: d4e5f6a7b8c9
Revises: a1f2e3d4c5b6
Create Date: 2026-06-12 10:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'a1f2e3d4c5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('github_repositories', sa.Column('webhook_hook_id', sa.BigInteger(), nullable=True))

    op.create_table(
        'github_oauth_tokens',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('organization_id', sa.UUID(), nullable=False),
        sa.Column('access_token', sa.String(length=500), nullable=False),
        sa.Column('scope', sa.String(length=500), nullable=False, server_default=''),
        sa.Column('github_user_login', sa.String(length=200), nullable=False),
        sa.Column('github_user_id', sa.BigInteger(), nullable=False),
        sa.Column('connected_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['connected_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('organization_id', name='uq_github_oauth_token_org'),
    )
    op.create_index(op.f('ix_github_oauth_tokens_organization_id'), 'github_oauth_tokens', ['organization_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_github_oauth_tokens_organization_id'), table_name='github_oauth_tokens')
    op.drop_table('github_oauth_tokens')
    op.drop_column('github_repositories', 'webhook_hook_id')
