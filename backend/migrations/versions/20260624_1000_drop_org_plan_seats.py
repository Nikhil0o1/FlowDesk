"""org: drop plan and seats columns

Billing tiers are not active. plan was an unenforced label; seats
was the only enforcement mechanism. Both are removed so the model
reflects what the system actually does.

Revision ID: h5i6j7k8l9m0
Revises: g4h5i6j7k8l9
Create Date: 2026-06-24 10:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "h5i6j7k8l9m0"
down_revision: Union[str, None] = "g4h5i6j7k8l9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("organizations", "plan")
    op.drop_column("organizations", "seats")


def downgrade() -> None:
    op.add_column("organizations", sa.Column("seats", sa.Integer(), nullable=False, server_default="10"))
    op.add_column("organizations", sa.Column("plan", sa.String(40), nullable=False, server_default="free"))
