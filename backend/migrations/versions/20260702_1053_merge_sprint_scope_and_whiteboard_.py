"""merge sprint scope and whiteboard branches

Revision ID: b4fcd7e01de5
Revises: q4r5s6t7u8v9, wbprojgench01
Create Date: 2026-07-02 10:53:18.948390+00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "b4fcd7e01de5"
down_revision: Union[str, Sequence[str], None] = ("q4r5s6t7u8v9", "wbprojgench01")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
