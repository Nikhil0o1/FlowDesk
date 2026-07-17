"""github shared connection: workspace-scoped -> project-scoped

The shared GitHub connection moves from one-per-workspace to one-per-project
(the project lead's account, shared by everyone on that project). Replaces
workspace_id with project_id and the partial-unique accordingly. Existing
workspace connections cannot be mapped to a single project, so they are dropped
(they were unreleased) — re-connect per project.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-06-15 16:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('github_connections', sa.Column('project_id', sa.UUID(), nullable=True))

    # Workspace connections can't be auto-mapped to a project — drop them.
    op.execute("DELETE FROM github_connections WHERE connection_type = 'workspace'")
    # Repos linked via those connections lose their operating connection.
    op.execute("UPDATE github_repositories SET connection_id = NULL "
               "WHERE connection_id NOT IN (SELECT id FROM github_connections)")

    op.drop_index('uq_github_conn_workspace', table_name='github_connections')
    op.drop_index('ix_github_connections_workspace_id', table_name='github_connections')
    op.drop_constraint('fk_github_connections_workspace_id_workspaces',
                       'github_connections', type_='foreignkey')
    op.drop_column('github_connections', 'workspace_id')

    op.create_foreign_key('fk_github_connections_project_id_projects',
                          'github_connections', 'projects',
                          ['project_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_github_connections_project_id', 'github_connections', ['project_id'])
    op.create_index('uq_github_conn_project', 'github_connections', ['project_id'],
                    unique=True, postgresql_where=sa.text("connection_type = 'project'"))


def downgrade() -> None:
    op.execute("DELETE FROM github_connections WHERE connection_type = 'project'")
    op.drop_index('uq_github_conn_project', table_name='github_connections')
    op.drop_index('ix_github_connections_project_id', table_name='github_connections')
    op.drop_constraint('fk_github_connections_project_id_projects',
                       'github_connections', type_='foreignkey')
    op.drop_column('github_connections', 'project_id')

    op.add_column('github_connections', sa.Column('workspace_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_github_connections_workspace_id_workspaces',
                          'github_connections', 'workspaces',
                          ['workspace_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_github_connections_workspace_id', 'github_connections', ['workspace_id'])
    op.create_index('uq_github_conn_workspace', 'github_connections', ['workspace_id'],
                    unique=True, postgresql_where=sa.text("connection_type = 'workspace'"))
