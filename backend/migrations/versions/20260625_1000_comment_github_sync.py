"""comments: github_comment_id and github_author_login for bidirectional sync

Revision ID: l9m0n1o2p3q4
Revises: k8l9m0n1o2p3
Create Date: 2026-06-25 10:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "l9m0n1o2p3q4"
down_revision: Union[str, None] = "k8l9m0n1o2p3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("comments", sa.Column("github_comment_id", sa.BigInteger(), nullable=True))
    op.add_column("comments", sa.Column("github_author_login", sa.String(length=255), nullable=True))
    op.create_index("ix_comments_github_comment_id", "comments", ["github_comment_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_comments_github_comment_id", table_name="comments")
    op.drop_column("comments", "github_author_login")
    op.drop_column("comments", "github_comment_id")
