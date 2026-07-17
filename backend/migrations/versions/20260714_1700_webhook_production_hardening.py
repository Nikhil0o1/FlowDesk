"""webhook production hardening: retrying status, dual-secret grace, retention fields

Revision ID: webhookprod01
Revises: patharden01
Create Date: 2026-07-14 17:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "webhookprod01"
down_revision: Union[str, Sequence[str], None] = "patharden01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "webhook_endpoints",
        sa.Column("previous_secret_encrypted", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "webhook_endpoints",
        sa.Column("previous_secret_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "webhook_endpoints",
        sa.Column("disabled_reason", sa.String(length=32), nullable=True),
    )

    op.add_column(
        "webhook_deliveries",
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default=sa.text("6")),
    )
    op.add_column(
        "webhook_deliveries",
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "webhook_deliveries",
        sa.Column("api_version", sa.String(length=32), nullable=False, server_default="2026-07-14"),
    )
    op.add_column(
        "webhook_deliveries",
        sa.Column("redelivered_from_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_webhook_deliveries_redelivered_from",
        "webhook_deliveries",
        "webhook_deliveries",
        ["redelivered_from_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_webhook_deliveries_status_updated",
        "webhook_deliveries",
        ["status", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_webhook_deliveries_status_updated", table_name="webhook_deliveries")
    op.drop_constraint(
        "fk_webhook_deliveries_redelivered_from", "webhook_deliveries", type_="foreignkey"
    )
    op.drop_column("webhook_deliveries", "redelivered_from_id")
    op.drop_column("webhook_deliveries", "api_version")
    op.drop_column("webhook_deliveries", "next_retry_at")
    op.drop_column("webhook_deliveries", "max_attempts")
    op.drop_column("webhook_endpoints", "disabled_reason")
    op.drop_column("webhook_endpoints", "previous_secret_expires_at")
    op.drop_column("webhook_endpoints", "previous_secret_encrypted")
