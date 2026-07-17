"""2fa: TOTP secret + recovery codes + org require_2fa

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-06-18 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'c0d1e2f3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('totp_secret_enc', sa.String(length=255), nullable=True))
    op.add_column(
        'users',
        sa.Column('totp_enabled', sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column('users', sa.Column('totp_confirmed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'organizations',
        sa.Column('require_2fa', sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    op.create_table(
        'two_factor_recovery_codes',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('code_hash', sa.String(length=128), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_two_factor_recovery_codes_user_id', 'two_factor_recovery_codes', ['user_id']
    )

    # server_default only existed to backfill existing rows; the app/ORM owns the
    # default going forward (matches the rest of the schema's boolean columns).
    op.alter_column('users', 'totp_enabled', server_default=None)
    op.alter_column('organizations', 'require_2fa', server_default=None)


def downgrade() -> None:
    op.drop_index('ix_two_factor_recovery_codes_user_id', table_name='two_factor_recovery_codes')
    op.drop_table('two_factor_recovery_codes')
    op.drop_column('organizations', 'require_2fa')
    op.drop_column('users', 'totp_confirmed_at')
    op.drop_column('users', 'totp_enabled')
    op.drop_column('users', 'totp_secret_enc')
