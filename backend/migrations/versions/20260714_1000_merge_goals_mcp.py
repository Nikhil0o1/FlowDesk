"""merge goals and mcp audit branches

Revision ID: mergegoalsmcp01
Revises: goals20260709, mcpaudit01
Create Date: 2026-07-14 10:00:00.000000
"""
from typing import Sequence, Union

revision: str = "mergegoalsmcp01"
down_revision: Union[str, tuple[str, ...], None] = ("goals20260709", "mcpaudit01")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
