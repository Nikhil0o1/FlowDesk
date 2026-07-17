"""github oauth tokens become per-user (per organization)

Previously a single GitHub OAuth token was stored per organization
(uq_github_oauth_token_org), so every member shared — and overwrote — one
connection. This makes the connection private to each (organization, user)
pair: add user_id, backfill it from connected_by, drop the org-only unique
constraint and add a (organization_id, user_id) unique constraint.

This also unifies the two migration heads that existed on main
(f1a2b3c4d5e6 — sheet two-way sync, and c9d0e1f2a3b4 — calendar/merge),
so `alembic upgrade head` resolves to a single head again.

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6, c9d0e1f2a3b4
Create Date: 2026-06-15 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = ('f1a2b3c4d5e6', 'c9d0e1f2a3b4')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add the column nullable so existing rows survive the migration.
    op.add_column('github_oauth_tokens', sa.Column('user_id', sa.UUID(), nullable=True))

    # 2. Best-effort backfill: the connecting user is the natural owner.
    op.execute(
        "UPDATE github_oauth_tokens SET user_id = connected_by WHERE user_id IS NULL"
    )
    # 3. Any row we still can't attribute to a user is an orphan shared token;
    #    drop it so the new NOT NULL + unique constraint can be enforced.
    op.execute("DELETE FROM github_oauth_tokens WHERE user_id IS NULL")

    # 4. Swap the uniqueness from org-only to (org, user).
    op.drop_constraint('uq_github_oauth_token_org', 'github_oauth_tokens', type_='unique')
    op.alter_column('github_oauth_tokens', 'user_id', existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(
        'fk_github_oauth_tokens_user_id_users',
        'github_oauth_tokens', 'users',
        ['user_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        op.f('ix_github_oauth_tokens_user_id'), 'github_oauth_tokens', ['user_id']
    )
    op.create_unique_constraint(
        'uq_github_oauth_org_user', 'github_oauth_tokens', ['organization_id', 'user_id']
    )


def downgrade() -> None:
    op.drop_constraint('uq_github_oauth_org_user', 'github_oauth_tokens', type_='unique')
    op.drop_index(op.f('ix_github_oauth_tokens_user_id'), table_name='github_oauth_tokens')
    op.drop_constraint('fk_github_oauth_tokens_user_id_users', 'github_oauth_tokens', type_='foreignkey')
    op.drop_column('github_oauth_tokens', 'user_id')
    # Restore the org-only unique constraint (may fail if duplicates now exist).
    op.create_unique_constraint('uq_github_oauth_token_org', 'github_oauth_tokens', ['organization_id'])
