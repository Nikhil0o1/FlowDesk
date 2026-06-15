"""task github issue link

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-12 11:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('github_issue_number', sa.BigInteger(), nullable=True))
    op.add_column('tasks', sa.Column('github_issue_url', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'github_issue_url')
    op.drop_column('tasks', 'github_issue_number')
