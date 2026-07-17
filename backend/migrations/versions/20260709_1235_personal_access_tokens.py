"""personal access tokens for MCP / automation

Revision ID: patmcp01
Revises: chatfavdefault01
Create Date: 2026-07-09 12:35:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "patmcp01"
down_revision: Union[str, Sequence[str], None] = "chatfavdefault01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "personal_access_tokens",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("token_prefix", sa.String(length=16), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.String(length=40)), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pat_user_active", "personal_access_tokens", ["user_id", "revoked_at"])
    op.create_index("ix_pat_token_hash", "personal_access_tokens", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_pat_token_hash", table_name="personal_access_tokens")
    op.drop_index("ix_pat_user_active", table_name="personal_access_tokens")
    op.drop_table("personal_access_tokens")
