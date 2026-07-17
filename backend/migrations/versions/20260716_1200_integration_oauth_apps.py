"""Integration OAuth apps for Holocron/Brightcone (ClickUp-style).

Revision ID: integoauth01
Revises: mergesprintdoc01
Create Date: 2026-07-16 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "integoauth01"
down_revision: Union[str, Sequence[str], None] = "mergesprintdoc01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "integration_oauth_apps",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("client_id", sa.String(length=80), nullable=False),
        sa.Column("secret_public_id", sa.String(length=32), nullable=False),
        sa.Column("secret_digest", sa.String(length=128), nullable=False),
        sa.Column("hash_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("pepper_version", sa.Integer(), nullable=False),
        sa.Column("display_suffix", sa.String(length=8), nullable=False),
        sa.Column("redirect_uris", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("default_scopes", postgresql.ARRAY(sa.String(length=40)), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id"),
    )
    op.create_index(
        "ix_integration_oauth_apps_client_id",
        "integration_oauth_apps",
        ["client_id"],
        unique=True,
    )
    op.create_index(
        "ix_integration_oauth_apps_org",
        "integration_oauth_apps",
        ["organization_id", "revoked_at"],
    )

    op.create_table(
        "integration_oauth_auth_requests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("client_id", sa.String(length=80), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("state", sa.String(length=512), nullable=True),
        sa.Column("scopes", postgresql.ARRAY(sa.String(length=40)), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_integration_oauth_auth_req_expires",
        "integration_oauth_auth_requests",
        ["expires_at"],
    )

    op.create_table(
        "integration_oauth_auth_codes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("code_hash", sa.String(length=128), nullable=False),
        sa.Column("client_id", sa.String(length=80), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.String(length=40)), nullable=False),
        sa.Column("pat_id", sa.UUID(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["pat_id"], ["personal_access_tokens.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index(
        "ix_integration_oauth_code_hash",
        "integration_oauth_auth_codes",
        ["code_hash"],
        unique=True,
    )
    op.create_index(
        "ix_integration_oauth_code_expires",
        "integration_oauth_auth_codes",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_integration_oauth_code_expires", table_name="integration_oauth_auth_codes")
    op.drop_index("ix_integration_oauth_code_hash", table_name="integration_oauth_auth_codes")
    op.drop_table("integration_oauth_auth_codes")
    op.drop_index("ix_integration_oauth_auth_req_expires", table_name="integration_oauth_auth_requests")
    op.drop_table("integration_oauth_auth_requests")
    op.drop_index("ix_integration_oauth_apps_org", table_name="integration_oauth_apps")
    op.drop_index("ix_integration_oauth_apps_client_id", table_name="integration_oauth_apps")
    op.drop_table("integration_oauth_apps")
