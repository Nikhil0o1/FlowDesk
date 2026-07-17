"""documents module

Revision ID: docs20260707
Revises: mergechatpresence01
Create Date: 2026-07-07 16:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "docs20260707"
down_revision: Union[str, None] = "mergechatpresence01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "doc_folders",
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_id"], ["doc_folders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_doc_folders_created_by"), "doc_folders", ["created_by"], unique=False)
    op.create_index(op.f("ix_doc_folders_parent_id"), "doc_folders", ["parent_id"], unique=False)
    op.create_index(op.f("ix_doc_folders_workspace_id"), "doc_folders", ["workspace_id"], unique=False)

    op.create_table(
        "documents",
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("folder_id", sa.UUID(), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("updated_by", sa.UUID(), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.UUID(), nullable=True),
        sa.Column("original_folder_id", sa.UUID(), nullable=True),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("view_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("template_id", sa.String(length=64), nullable=True),
        sa.Column("is_private", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("public_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("public_token", sa.String(length=64), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["folder_id"], ["doc_folders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_documents_archived_at"), "documents", ["archived_at"], unique=False)
    op.create_index(op.f("ix_documents_created_by"), "documents", ["created_by"], unique=False)
    op.create_index(op.f("ix_documents_deleted_at"), "documents", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_documents_folder_id"), "documents", ["folder_id"], unique=False)
    op.create_index(op.f("ix_documents_public_token"), "documents", ["public_token"], unique=True)
    op.create_index(op.f("ix_documents_workspace_id"), "documents", ["workspace_id"], unique=False)

    op.create_table(
        "document_share_members",
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "user_id", name="uq_document_share_member"),
    )
    op.create_index(op.f("ix_document_share_members_document_id"), "document_share_members", ["document_id"], unique=False)
    op.create_index(op.f("ix_document_share_members_user_id"), "document_share_members", ["user_id"], unique=False)

    op.create_table(
        "document_comments",
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("author_id", sa.UUID(), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("inline_marker_id", sa.String(length=64), nullable=True),
        sa.Column("inline_quote", sa.Text(), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["document_comments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_document_comments_author_id"), "document_comments", ["author_id"], unique=False)
    op.create_index(op.f("ix_document_comments_document_id"), "document_comments", ["document_id"], unique=False)
    op.create_index(op.f("ix_document_comments_parent_id"), "document_comments", ["parent_id"], unique=False)

    op.create_table(
        "document_versions",
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("author_id", sa.UUID(), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "version_number", name="uq_document_version_number"),
    )
    op.create_index(op.f("ix_document_versions_author_id"), "document_versions", ["author_id"], unique=False)
    op.create_index(op.f("ix_document_versions_document_id"), "document_versions", ["document_id"], unique=False)

    op.create_table(
        "document_activity",
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("actor_id", sa.UUID(), nullable=False),
        sa.Column("detail", sa.String(length=500), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_document_activity_actor_id"), "document_activity", ["actor_id"], unique=False)
    op.create_index(op.f("ix_document_activity_document_id"), "document_activity", ["document_id"], unique=False)

    op.create_table(
        "document_favorites",
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("target_id", sa.UUID(), nullable=False),
        sa.Column("target_type", sa.String(length=10), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "target_id", name="uq_document_favorite"),
    )
    op.create_index(op.f("ix_document_favorites_target_id"), "document_favorites", ["target_id"], unique=False)
    op.create_index(op.f("ix_document_favorites_user_id"), "document_favorites", ["user_id"], unique=False)
    op.create_index(op.f("ix_document_favorites_workspace_id"), "document_favorites", ["workspace_id"], unique=False)

    op.create_table(
        "document_recent",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "document_id", name="uq_document_recent"),
    )
    op.create_index(op.f("ix_document_recent_document_id"), "document_recent", ["document_id"], unique=False)
    op.create_index(op.f("ix_document_recent_user_id"), "document_recent", ["user_id"], unique=False)

    op.add_column("mentions", sa.Column("document_comment_id", sa.UUID(), nullable=True))
    op.create_index(op.f("ix_mentions_document_comment_id"), "mentions", ["document_comment_id"], unique=False)
    op.create_foreign_key(
        "fk_mentions_document_comment_id",
        "mentions",
        "document_comments",
        ["document_comment_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_mentions_document_comment_id", "mentions", type_="foreignkey")
    op.drop_index(op.f("ix_mentions_document_comment_id"), table_name="mentions")
    op.drop_column("mentions", "document_comment_id")
    op.drop_table("document_recent")
    op.drop_table("document_favorites")
    op.drop_table("document_activity")
    op.drop_table("document_versions")
    op.drop_table("document_comments")
    op.drop_table("document_share_members")
    op.drop_table("documents")
    op.drop_table("doc_folders")
