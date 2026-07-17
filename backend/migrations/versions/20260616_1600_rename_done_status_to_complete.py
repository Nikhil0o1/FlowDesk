"""rename default 'Done' status to 'Complete'

Standardizes the done-category default status name across existing projects.
Safe rename only; custom statuses (including 'In Review') are untouched.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-06-16 16:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE custom_statuses SET name = 'Complete' WHERE name = 'Done' AND category = 'done'")


def downgrade() -> None:
    op.execute("UPDATE custom_statuses SET name = 'Done' WHERE name = 'Complete' AND category = 'done'")
