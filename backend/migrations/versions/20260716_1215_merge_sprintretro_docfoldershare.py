"""merge sprint retrospectives and doc folder sharing branches

Revision ID: mergesprintdoc01
Revises: sprintretro01, docfoldershare01
Create Date: 2026-07-16 12:15:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "mergesprintdoc01"
down_revision: Union[str, tuple[str, ...], None] = ("sprintretro01", "docfoldershare01")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
