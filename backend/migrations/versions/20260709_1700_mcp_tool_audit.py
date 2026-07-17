"""MCP tool invocation audit log

Revision ID: mcpaudit01
Revises: mcpoauth01
Create Date: 2026-07-09 17:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "mcpaudit01"
down_revision: Union[str, Sequence[str], None] = "mcpoauth01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mcp_tool_invocations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_id", sa.UUID(), nullable=True),
        sa.Column("tool", sa.String(length=120), nullable=False),
        sa.Column("args_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("resource_ids", postgresql.ARRAY(sa.String(length=64)), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["token_id"], ["personal_access_tokens.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mcp_audit_user_created", "mcp_tool_invocations", ["user_id", "created_at"])
    op.create_index("ix_mcp_audit_token_created", "mcp_tool_invocations", ["token_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_mcp_audit_token_created", table_name="mcp_tool_invocations")
    op.drop_index("ix_mcp_audit_user_created", table_name="mcp_tool_invocations")
    op.drop_table("mcp_tool_invocations")
