"""project: drop key column

Projects are identified by UUID (like workspaces and organizations).
Task references use the first 8 hex chars of the project id plus task number.

Revision ID: k8l9m0n1o2p3
Revises: j7k8l9m0n1o2
Create Date: 2026-06-25 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "k8l9m0n1o2p3"
down_revision: Union[str, None] = "j7k8l9m0n1o2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_project_key_per_workspace", "projects", type_="unique")
    op.drop_column("projects", "key")


def downgrade() -> None:
    op.add_column("projects", sa.Column("key", sa.String(length=10), nullable=True))
    op.execute("UPDATE projects SET key = UPPER(SUBSTRING(REPLACE(CAST(id AS TEXT), '-', ''), 1, 8))")
    op.alter_column("projects", "key", nullable=False)
    op.create_unique_constraint("uq_project_key_per_workspace", "projects", ["workspace_id", "key"])
