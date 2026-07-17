import uuid

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPkMixin

# GitHub connection types (see GithubConnection)
CONNECTION_PERSONAL = "personal"
CONNECTION_PROJECT = "project"


class GithubInstallation(Base, UUIDPkMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "github_installations"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    installation_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    account_login: Mapped[str] = mapped_column(String(200), nullable=False)
    account_type: Mapped[str] = mapped_column(String(20), default="Organization", nullable=False)
    installed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class GithubRepository(Base, UUIDPkMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "github_repositories"

    # Legacy GitHub-App grouping (nullable now that OAuth connections are primary)
    installation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("github_installations.id", ondelete="CASCADE"), index=True
    )
    # The workspace connection whose token operates this repo (webhooks, status mirror)
    connection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("github_connections.id", ondelete="SET NULL"), index=True
    )
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    repo_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    repo_full_name: Mapped[str] = mapped_column(String(300), index=True, nullable=False)
    default_branch: Mapped[str] = mapped_column(String(120), default="main", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    connected_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    webhook_hook_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class GithubEvent(Base, UUIDPkMixin, TimestampMixin):
    __tablename__ = "github_events"
    __table_args__ = (Index("ix_github_events_repo_created", "repository_id", "created_at"),)

    repository_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("github_repositories.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)  # push | pull_request | issues
    action: Mapped[str | None] = mapped_column(String(40))  # opened | closed | merged | ...
    actor_login: Mapped[str | None] = mapped_column(String(200))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), index=True
    )
    delivery_id: Mapped[str | None] = mapped_column(String(80), unique=True)


class GithubConnection(Base, UUIDPkMixin, TimestampMixin):
    """A GitHub OAuth connection. Two kinds:

    - ``personal`` — one per (organization, user). Acts AS the member: create
      issues / branches / PRs, link previews. Private to that user.
    - ``project`` — one per project, created by a project lead/admin. Shared by
      everyone on that project: powers incoming webhook activity sync, task
      status automation, repo linking and connected search. Independent per
      project, so the same person leading two projects connects each separately.
    """

    __tablename__ = "github_connections"
    __table_args__ = (
        # A user has at most one personal connection per organization
        Index(
            "uq_github_conn_personal", "organization_id", "user_id",
            unique=True, postgresql_where=text("connection_type = 'personal'"),
        ),
        # A project has at most one shared connection
        Index(
            "uq_github_conn_project", "project_id",
            unique=True, postgresql_where=text("connection_type = 'project'"),
        ),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"),
        index=True, nullable=False
    )
    connection_type: Mapped[str] = mapped_column(
        String(20), default=CONNECTION_PERSONAL, nullable=False
    )  # personal | project
    # Set for personal connections
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Set for project connections
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    access_token: Mapped[str] = mapped_column(String(500), nullable=False)
    scope: Mapped[str] = mapped_column(String(500), default="", nullable=False)  # OAuth scopes granted
    github_user_login: Mapped[str] = mapped_column(String(200), nullable=False)
    github_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    connected_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    # Project-connection settings (unused for personal)
    branch_name_format: Mapped[str] = mapped_column(
        String(200), default=":taskId:-:taskName:", nullable=False
    )
    connected_search_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
