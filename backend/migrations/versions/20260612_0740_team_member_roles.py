"""team member roles

Revision ID: b7c8d9e0f1a2
Revises: a1f2e3d4c5b6
Create Date: 2026-06-12 07:40:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "a1f2e3d4c5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "team_members",
        sa.Column("role", sa.String(length=20), nullable=False, server_default="member"),
    )
    op.alter_column("team_members", "role", server_default=None)


def downgrade() -> None:
    op.drop_column("team_members", "role")
