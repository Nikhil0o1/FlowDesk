"""add users.microsoft_sub for Microsoft / Entra ID SSO

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-06-17 10:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b9c0d1e2f3a4'
down_revision: Union[str, None] = 'a8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('microsoft_sub', sa.String(length=64), nullable=True))
    op.create_unique_constraint('uq_users_microsoft_sub', 'users', ['microsoft_sub'])


def downgrade() -> None:
    op.drop_constraint('uq_users_microsoft_sub', 'users', type_='unique')
    op.drop_column('users', 'microsoft_sub')
