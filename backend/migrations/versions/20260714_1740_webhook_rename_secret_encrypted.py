"""rename webhook_endpoints.secret_hash -> secret_encrypted

Revision ID: webhookfix01
Revises: webhookprod01
Create Date: 2026-07-14 17:40:00.000000

Local DBs created from an intermediate model used secret_hash; the canonical
column is secret_encrypted (Fernet). Safe when the table is empty or when
values are already Fernet tokens under the old name.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "webhookfix01"
down_revision: Union[str, Sequence[str], None] = "webhookprod01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("webhook_endpoints")}
    if "secret_hash" in cols and "secret_encrypted" not in cols:
        op.alter_column(
            "webhook_endpoints",
            "secret_hash",
            new_column_name="secret_encrypted",
            existing_type=sa.String(length=512),
            existing_nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("webhook_endpoints")}
    if "secret_encrypted" in cols and "secret_hash" not in cols:
        op.alter_column(
            "webhook_endpoints",
            "secret_encrypted",
            new_column_name="secret_hash",
            existing_type=sa.String(length=512),
            existing_nullable=False,
        )
