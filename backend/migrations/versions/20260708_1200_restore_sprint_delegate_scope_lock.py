"""restore sprint delegate scrum master and scope lock columns

Revision ID: sprintrestore01
Revises: mergeinboxdocs01
Create Date: 2026-07-08 12:00:00.000000

The drop_delegate_scope_lock migration (q4r5s6t7u8v9) removed these columns,
but the code that used them was restored when PR #75 was reverted. Re-add
them so the Sprint model matches the database again. Guarded so it is safe
on databases that never ran the drop (fresh installs replay drop -> restore).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "sprintrestore01"
down_revision: Union[str, Sequence[str], None] = "mergeinboxdocs01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _sprint_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {col["name"] for col in inspector.get_columns("sprints")}


def upgrade() -> None:
    existing = _sprint_columns()

    if "scope_locked" not in existing:
        op.add_column(
            "sprints",
            sa.Column("scope_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.alter_column("sprints", "scope_locked", server_default=None)

    if "delegate_scrum_master_id" not in existing:
        op.add_column(
            "sprints",
            sa.Column("delegate_scrum_master_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            "fk_sprints_delegate_scrum_master_id_users",
            "sprints",
            "users",
            ["delegate_scrum_master_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    existing = _sprint_columns()

    if "delegate_scrum_master_id" in existing:
        op.drop_constraint(
            "fk_sprints_delegate_scrum_master_id_users", "sprints", type_="foreignkey"
        )
        op.drop_column("sprints", "delegate_scrum_master_id")

    if "scope_locked" in existing:
        op.drop_column("sprints", "scope_locked")
