"""merge calendar sync and team member roles branches

Revision ID: c9d0e1f2a3b4
Revises: f6a7b8c9d0e1, b7c8d9e0f1a2
Create Date: 2026-06-12 13:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, tuple[str, ...], None] = ('f6a7b8c9d0e1', 'b7c8d9e0f1a2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
