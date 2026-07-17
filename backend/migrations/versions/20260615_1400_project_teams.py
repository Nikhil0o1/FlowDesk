"""project teams: assign workspace teams to projects

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-06-15 14:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'project_teams',
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('team_id', sa.UUID(), nullable=False),
        sa.Column('default_role', sa.String(length=20), nullable=False),
        sa.Column('assigned_by', sa.UUID(), nullable=True),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['assigned_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'team_id', name='uq_project_team'),
    )
    op.create_index(op.f('ix_project_teams_project_id'), 'project_teams', ['project_id'], unique=False)
    op.create_index(op.f('ix_project_teams_team_id'), 'project_teams', ['team_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_project_teams_team_id'), table_name='project_teams')
    op.drop_index(op.f('ix_project_teams_project_id'), table_name='project_teams')
    op.drop_table('project_teams')
