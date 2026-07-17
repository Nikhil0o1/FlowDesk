"""personal list projects (per user per workspace)

Revision ID: personalproj01
Revises: taskfollow01
Create Date: 2026-07-07 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "personalproj01"
down_revision: str = "taskfollow01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("is_personal", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "projects",
        sa.Column(
            "personal_owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.alter_column("projects", "space_id", existing_type=postgresql.UUID(), nullable=True)
    op.create_index("ix_projects_personal_owner_id", "projects", ["personal_owner_id"])
    op.create_index(
        "uq_projects_personal_per_workspace",
        "projects",
        ["workspace_id", "personal_owner_id"],
        unique=True,
        postgresql_where=sa.text("is_personal = true AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_projects_personal_per_workspace", table_name="projects")
    op.drop_index("ix_projects_personal_owner_id", table_name="projects")
    op.alter_column("projects", "space_id", existing_type=postgresql.UUID(), nullable=False)
    op.drop_column("projects", "personal_owner_id")
    op.drop_column("projects", "is_personal")
