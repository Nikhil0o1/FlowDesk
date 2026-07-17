"""github connections: personal + workspace types

Generalises the per-user github_oauth_tokens table into github_connections
supporting two connection types (personal, per org+user; workspace, per
workspace). Adds workspace-connection settings and links repositories to the
workspace connection that operates them.

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-06-15 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- rename + generalise the connection table ---
    op.rename_table('github_oauth_tokens', 'github_connections')

    op.add_column('github_connections', sa.Column(
        'connection_type', sa.String(length=20), nullable=False, server_default='personal'))
    op.add_column('github_connections', sa.Column('workspace_id', sa.UUID(), nullable=True))
    op.add_column('github_connections', sa.Column(
        'branch_name_format', sa.String(length=200), nullable=False, server_default=':taskId:-:taskName:'))
    op.add_column('github_connections', sa.Column(
        'connected_search_enabled', sa.Boolean(), nullable=False, server_default=sa.true()))

    # user_id is now only set for personal connections
    op.alter_column('github_connections', 'user_id', existing_type=sa.UUID(), nullable=True)

    # swap org-only-style uniqueness for type-aware partial unique indexes
    op.drop_constraint('uq_github_oauth_org_user', 'github_connections', type_='unique')
    op.create_index('uq_github_conn_personal', 'github_connections',
                    ['organization_id', 'user_id'], unique=True,
                    postgresql_where=sa.text("connection_type = 'personal'"))
    op.create_index('uq_github_conn_workspace', 'github_connections',
                    ['workspace_id'], unique=True,
                    postgresql_where=sa.text("connection_type = 'workspace'"))

    op.create_foreign_key('fk_github_connections_workspace_id_workspaces',
                          'github_connections', 'workspaces',
                          ['workspace_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_github_connections_workspace_id', 'github_connections', ['workspace_id'])

    # tidy the inherited index names
    op.execute('ALTER INDEX IF EXISTS ix_github_oauth_tokens_organization_id '
               'RENAME TO ix_github_connections_organization_id')
    op.execute('ALTER INDEX IF EXISTS ix_github_oauth_tokens_user_id '
               'RENAME TO ix_github_connections_user_id')

    # --- repositories point at the workspace connection that operates them ---
    op.add_column('github_repositories', sa.Column('connection_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_github_repositories_connection_id_github_connections',
                          'github_repositories', 'github_connections',
                          ['connection_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_github_repositories_connection_id', 'github_repositories', ['connection_id'])
    op.alter_column('github_repositories', 'installation_id', existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    op.alter_column('github_repositories', 'installation_id', existing_type=sa.UUID(), nullable=False)
    op.drop_index('ix_github_repositories_connection_id', table_name='github_repositories')
    op.drop_constraint('fk_github_repositories_connection_id_github_connections',
                       'github_repositories', type_='foreignkey')
    op.drop_column('github_repositories', 'connection_id')

    op.execute('ALTER INDEX IF EXISTS ix_github_connections_user_id '
               'RENAME TO ix_github_oauth_tokens_user_id')
    op.execute('ALTER INDEX IF EXISTS ix_github_connections_organization_id '
               'RENAME TO ix_github_oauth_tokens_organization_id')
    op.drop_index('ix_github_connections_workspace_id', table_name='github_connections')
    op.drop_constraint('fk_github_connections_workspace_id_workspaces',
                       'github_connections', type_='foreignkey')
    op.drop_index('uq_github_conn_workspace', table_name='github_connections')
    op.drop_index('uq_github_conn_personal', table_name='github_connections')
    op.create_unique_constraint('uq_github_oauth_org_user', 'github_connections',
                                ['organization_id', 'user_id'])
    op.alter_column('github_connections', 'user_id', existing_type=sa.UUID(), nullable=False)
    op.drop_column('github_connections', 'connected_search_enabled')
    op.drop_column('github_connections', 'branch_name_format')
    op.drop_column('github_connections', 'workspace_id')
    op.drop_column('github_connections', 'connection_type')
    op.rename_table('github_connections', 'github_oauth_tokens')
