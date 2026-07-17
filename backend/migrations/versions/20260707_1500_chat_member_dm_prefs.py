"""chat member dm preferences

Revision ID: chatdmprefs01
Revises: c7mergeheads
Create Date: 2026-07-07 15:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "chatdmprefs01"
down_revision: Union[str, Sequence[str], None] = "c7mergeheads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chat_members", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "chat_members",
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("chat_members", "is_favorite", server_default=None)


def downgrade() -> None:
    op.drop_column("chat_members", "is_favorite")
    op.drop_column("chat_members", "closed_at")
