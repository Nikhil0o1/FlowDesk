"""merge chat attachments and presence analytics branches

Revision ID: mergechatpresence01
Revises: chatattach01, presenceanalytics01
Create Date: 2026-07-03 13:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "mergechatpresence01"
down_revision: Union[str, tuple[str, ...], None] = ("chatattach01", "presenceanalytics01")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
