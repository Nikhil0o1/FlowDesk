"""doc cover, page settings, document links

Revision ID: docs3_20260707
Revises: docs2_20260707
Create Date: 2026-07-07 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "docs3_20260707"
down_revision: Union[str, None] = "docs2_20260707"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("cover_url", sa.Text(), nullable=True))
    op.add_column(
        "documents",
        sa.Column("page_settings", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )

    op.create_table(
        "document_links",
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "target_type", "target_id", name="uq_document_link_target"),
    )
    op.create_index(op.f("ix_document_links_document_id"), "document_links", ["document_id"], unique=False)
    op.create_index(op.f("ix_document_links_target_id"), "document_links", ["target_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_document_links_target_id"), table_name="document_links")
    op.drop_index(op.f("ix_document_links_document_id"), table_name="document_links")
    op.drop_table("document_links")
    op.drop_column("documents", "page_settings")
    op.drop_column("documents", "cover_url")
