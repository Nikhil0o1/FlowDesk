"""docs wiki, protect, custom templates

Revision ID: docs2_20260707
Revises: docs20260707
Create Date: 2026-07-07 17:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "docs2_20260707"
down_revision: Union[str, None] = "docs20260707"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("is_wiki", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("documents", sa.Column("is_protected", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("documents", sa.Column("icon", sa.String(length=16), nullable=True))

    op.create_table(
        "document_templates",
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.String(length=500), server_default="", nullable=False),
        sa.Column("icon", sa.String(length=16), nullable=True),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_document_templates_created_by"), "document_templates", ["created_by"], unique=False)
    op.create_index(op.f("ix_document_templates_workspace_id"), "document_templates", ["workspace_id"], unique=False)


def downgrade() -> None:
    op.drop_table("document_templates")
    op.drop_column("documents", "icon")
    op.drop_column("documents", "is_protected")
    op.drop_column("documents", "is_wiki")
