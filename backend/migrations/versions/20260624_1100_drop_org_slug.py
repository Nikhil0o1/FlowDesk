"""org: drop slug column

Slug was a human-readable alias for the org. Since all API routes and
frontend navigation use org_id (UUID), slug serves no routing or lookup
purpose. Dropped entirely — org identity is the UUID.

Revision ID: i6j7k8l9m0n1
Revises: h5i6j7k8l9m0
Create Date: 2026-06-24 11:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "i6j7k8l9m0n1"
down_revision: Union[str, None] = "h5i6j7k8l9m0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_organizations_slug", table_name="organizations")
    op.drop_column("organizations", "slug")


def downgrade() -> None:
    op.add_column("organizations", sa.Column("slug", sa.String(120), nullable=True))
    op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=True)
