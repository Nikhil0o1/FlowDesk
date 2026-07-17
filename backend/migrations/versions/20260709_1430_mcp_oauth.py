"""MCP OAuth clients and authorization codes

Revision ID: mcpoauth01
Revises: patmcp01
Create Date: 2026-07-09 14:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "mcpoauth01"
down_revision: Union[str, Sequence[str], None] = "patmcp01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mcp_oauth_clients",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("client_secret_hash", sa.String(length=128), nullable=True),
        sa.Column("client_name", sa.String(length=200), nullable=False),
        sa.Column("redirect_uris", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("token_endpoint_auth_method", sa.String(length=40), nullable=False),
        sa.Column("client_id_issued_at", sa.Integer(), nullable=True),
        sa.Column("client_secret_expires_at", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id"),
    )
    op.create_index("ix_mcp_oauth_clients_client_id", "mcp_oauth_clients", ["client_id"], unique=True)

    op.create_table(
        "mcp_oauth_authorization_requests",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("code_challenge", sa.String(length=128), nullable=False),
        sa.Column("state", sa.String(length=512), nullable=True),
        sa.Column("scopes", postgresql.ARRAY(sa.String(length=40)), nullable=False),
        sa.Column("resource", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_mcp_oauth_auth_req_expires",
        "mcp_oauth_authorization_requests",
        ["expires_at"],
    )

    op.create_table(
        "mcp_oauth_authorization_codes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("code_hash", sa.String(length=128), nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("code_challenge", sa.String(length=128), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.String(length=40)), nullable=False),
        sa.Column("resource", sa.Text(), nullable=True),
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
    op.create_index("ix_mcp_oauth_code_hash", "mcp_oauth_authorization_codes", ["code_hash"], unique=True)
    op.create_index("ix_mcp_oauth_code_expires", "mcp_oauth_authorization_codes", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_mcp_oauth_code_expires", table_name="mcp_oauth_authorization_codes")
    op.drop_index("ix_mcp_oauth_code_hash", table_name="mcp_oauth_authorization_codes")
    op.drop_table("mcp_oauth_authorization_codes")
    op.drop_index("ix_mcp_oauth_auth_req_expires", table_name="mcp_oauth_authorization_requests")
    op.drop_table("mcp_oauth_authorization_requests")
    op.drop_index("ix_mcp_oauth_clients_client_id", table_name="mcp_oauth_clients")
    op.drop_table("mcp_oauth_clients")
