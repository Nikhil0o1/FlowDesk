"""task sharing/privacy, time estimate, checklists, custom fields

Adds per-task privacy + public links + time estimate columns to tasks, plus
tables for the share ACL, checklists and project custom fields.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-06-16 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- tasks: new columns ---
    op.add_column('tasks', sa.Column('time_estimate_minutes', sa.Integer(), nullable=True))
    op.add_column('tasks', sa.Column('is_private', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('tasks', sa.Column('public_token', sa.String(length=64), nullable=True))
    op.add_column('tasks', sa.Column('public_enabled', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index(op.f('ix_tasks_public_token'), 'tasks', ['public_token'], unique=True)

    # --- task_share_members ---
    op.create_table(
        'task_share_members',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('task_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False, server_default='editor'),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id', 'user_id', name='uq_task_share_member'),
    )
    op.create_index(op.f('ix_task_share_members_task_id'), 'task_share_members', ['task_id'])
    op.create_index(op.f('ix_task_share_members_user_id'), 'task_share_members', ['user_id'])

    # --- checklists ---
    op.create_table(
        'task_checklists',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('task_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False, server_default='Checklist'),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_task_checklists_task_id'), 'task_checklists', ['task_id'])
    op.create_table(
        'task_checklist_items',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('checklist_id', sa.UUID(), nullable=False),
        sa.Column('content', sa.String(length=1000), nullable=False),
        sa.Column('is_done', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['checklist_id'], ['task_checklists.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_task_checklist_items_checklist_id'), 'task_checklist_items', ['checklist_id'])

    # --- custom fields ---
    op.create_table(
        'custom_field_definitions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('field_type', sa.String(length=20), nullable=False, server_default='text'),
        sa.Column('options', sa.dialects.postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_custom_field_definitions_project_id'), 'custom_field_definitions', ['project_id'])
    op.create_table(
        'custom_field_values',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('field_id', sa.UUID(), nullable=False),
        sa.Column('task_id', sa.UUID(), nullable=False),
        sa.Column('value', sa.dialects.postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['field_id'], ['custom_field_definitions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('field_id', 'task_id', name='uq_custom_field_value'),
    )
    op.create_index(op.f('ix_custom_field_values_field_id'), 'custom_field_values', ['field_id'])
    op.create_index(op.f('ix_custom_field_values_task_id'), 'custom_field_values', ['task_id'])


def downgrade() -> None:
    op.drop_table('custom_field_values')
    op.drop_table('custom_field_definitions')
    op.drop_table('task_checklist_items')
    op.drop_table('task_checklists')
    op.drop_table('task_share_members')
    op.drop_index(op.f('ix_tasks_public_token'), table_name='tasks')
    op.drop_column('tasks', 'public_enabled')
    op.drop_column('tasks', 'public_token')
    op.drop_column('tasks', 'is_private')
    op.drop_column('tasks', 'time_estimate_minutes')
