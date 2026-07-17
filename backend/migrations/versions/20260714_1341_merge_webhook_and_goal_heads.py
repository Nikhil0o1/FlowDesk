"""merge webhook and goal heads

Revision ID: 8c55bb165226
Revises: webhookfix01, goalorder01
Create Date: 2026-07-14 13:41:42.890099+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8c55bb165226'
down_revision: Union[str, None] = ('webhookfix01', 'goalorder01')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
