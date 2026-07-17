"""give chat_members.is_favorite a server default

Revision ID: chatfavdefault01
Revises: sprintrestore01
Create Date: 2026-07-08 13:00:00.000000

chat_member_dm_prefs (chatdmprefs01) added is_favorite as NOT NULL and then
removed its server default. The code that populated it was reverted with
PR #75, so the current ChatMember model does not know the column and every
INSERT into chat_members (channel creation, workspace creation, invites)
fails with NotNullViolation. Re-add the default so inserts that omit the
column succeed. Guarded: a no-op on databases whose chain never created
the column.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "chatfavdefault01"
down_revision: Union[str, Sequence[str], None] = "sprintrestore01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_is_favorite() -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(col["name"] == "is_favorite" for col in inspector.get_columns("chat_members"))


def upgrade() -> None:
    if _has_is_favorite():
        op.alter_column("chat_members", "is_favorite", server_default=sa.false())


def downgrade() -> None:
    if _has_is_favorite():
        op.alter_column("chat_members", "is_favorite", server_default=None)
