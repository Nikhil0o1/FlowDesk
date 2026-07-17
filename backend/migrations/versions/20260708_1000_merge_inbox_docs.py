"""merge inbox/my-tasks and docs branches

Revision ID: mergeinboxdocs01
Revises: personalproj01, docs3_20260707
Create Date: 2026-07-08 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "mergeinboxdocs01"
down_revision: Union[str, tuple[str, ...], None] = ("personalproj01", "docs3_20260707")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
