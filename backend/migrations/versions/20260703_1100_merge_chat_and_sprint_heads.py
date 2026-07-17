"""merge chat attachments and sprint scope heads

Revision ID: c7mergeheads
Revises: b4fcd7e01de5, chatattach01
Create Date: 2026-07-03 11:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c7mergeheads"
down_revision: Union[str, Sequence[str], None] = ("b4fcd7e01de5", "chatattach01")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
