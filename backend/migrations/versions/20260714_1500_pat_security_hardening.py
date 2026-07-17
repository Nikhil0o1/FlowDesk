"""PAT columns for fd_live_ format, pepper versions, and delayed revocation

Revision ID: patharden01
Revises: webhooks01
Create Date: 2026-07-14 15:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "patharden01"
down_revision: Union[str, Sequence[str], None] = "webhooks01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("personal_access_tokens", sa.Column("public_key_id", sa.String(length=32), nullable=True))
    op.add_column("personal_access_tokens", sa.Column("secret_digest", sa.String(length=128), nullable=True))
    op.add_column("personal_access_tokens", sa.Column("display_suffix", sa.String(length=8), nullable=True))
    op.add_column(
        "personal_access_tokens",
        sa.Column("hash_version", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("personal_access_tokens", sa.Column("pepper_version", sa.Integer(), nullable=True))
    op.add_column(
        "personal_access_tokens",
        sa.Column("environment", sa.String(length=16), server_default="live", nullable=False),
    )
    op.add_column("personal_access_tokens", sa.Column("rotated_from_id", sa.UUID(), nullable=True))
    op.add_column("personal_access_tokens", sa.Column("revoke_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_pat_rotated_from",
        "personal_access_tokens",
        "personal_access_tokens",
        ["rotated_from_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_pat_public_key_id", "personal_access_tokens", ["public_key_id"], unique=True)
    op.create_index("ix_pat_revoke_at", "personal_access_tokens", ["revoke_at"])


def downgrade() -> None:
    op.drop_index("ix_pat_revoke_at", table_name="personal_access_tokens")
    op.drop_index("ix_pat_public_key_id", table_name="personal_access_tokens")
    op.drop_constraint("fk_pat_rotated_from", "personal_access_tokens", type_="foreignkey")
    op.drop_column("personal_access_tokens", "revoke_at")
    op.drop_column("personal_access_tokens", "rotated_from_id")
    op.drop_column("personal_access_tokens", "environment")
    op.drop_column("personal_access_tokens", "pepper_version")
    op.drop_column("personal_access_tokens", "hash_version")
    op.drop_column("personal_access_tokens", "display_suffix")
    op.drop_column("personal_access_tokens", "secret_digest")
    op.drop_column("personal_access_tokens", "public_key_id")
