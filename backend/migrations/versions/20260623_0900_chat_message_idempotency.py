"""Add client_message_id for chat send idempotency."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "g4h5i6j7k8l9"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("client_message_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_chat_messages_client_message_id",
        "chat_messages",
        ["client_message_id"],
        unique=False,
    )
    op.create_index(
        "uq_chat_messages_channel_client",
        "chat_messages",
        ["channel_id", "client_message_id"],
        unique=True,
        postgresql_where=sa.text("client_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_chat_messages_channel_client", table_name="chat_messages")
    op.drop_index("ix_chat_messages_client_message_id", table_name="chat_messages")
    op.drop_column("chat_messages", "client_message_id")
