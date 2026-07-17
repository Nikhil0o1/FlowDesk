import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel
from app.services.github_api_service import GitHubPathValidationError, parse_repo_full_name, validate_branch_name


# --------------------------------------------------------------------------
# Legacy GitHub-App installation (kept for backward compatibility)
# --------------------------------------------------------------------------

class InstallationCreate(BaseModel):
    installation_id: int
    account_login: str = Field(min_length=1, max_length=200)
    account_type: str = Field(default="Organization", max_length=20)


class InstallationOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    installation_id: int
    account_login: str
    account_type: str
    created_at: datetime


class RepositoryConnect(BaseModel):
    installation_id: uuid.UUID
    repo_id: int
    repo_full_name: str = Field(min_length=1, max_length=300)
    default_branch: str = Field(default="main", max_length=120)
    project_id: uuid.UUID | None = None
    workspace_id: uuid.UUID | None = None

    @field_validator("repo_full_name")
    @classmethod
    def validate_repo_full_name(cls, value: str) -> str:
        try:
            parse_repo_full_name(value.strip())
        except GitHubPathValidationError as exc:
            raise ValueError(str(exc)) from exc
        return value.strip()

    @field_validator("default_branch")
    @classmethod
    def validate_default_branch(cls, value: str) -> str:
        try:
            return validate_branch_name(value.strip())
        except GitHubPathValidationError as exc:
            raise ValueError(str(exc)) from exc


# --------------------------------------------------------------------------
# Connections (personal + workspace)
# --------------------------------------------------------------------------

class ConnectionStatusOut(BaseModel):
    connected: bool
    github_user_login: str | None = None
    needs_reconnect: bool = False
    connection_type: str | None = None  # personal | workspace
    # caller's ability to connect/disconnect/configure this connection
    can_manage: bool = False
    can_connect: bool = False
    can_disconnect: bool = False
    can_link_repo: bool = False
    connected_by: uuid.UUID | None = None
    # workspace-connection settings (null for personal)
    branch_name_format: str | None = None
    connected_search_enabled: bool | None = None


class ConnectionSettings(BaseModel):
    branch_name_format: str | None = Field(default=None, max_length=200)
    connected_search_enabled: bool | None = None


class AuthUrlOut(BaseModel):
    url: str


# --------------------------------------------------------------------------
# Repositories
# --------------------------------------------------------------------------

class AvailableRepo(BaseModel):
    repo_id: int
    repo_full_name: str
    default_branch: str
    private: bool


class RepoConnectBody(BaseModel):
    repo_full_name: str = Field(min_length=1, max_length=300)

    @field_validator("repo_full_name")
    @classmethod
    def validate_repo_full_name(cls, value: str) -> str:
        try:
            parse_repo_full_name(value.strip())
        except GitHubPathValidationError as exc:
            raise ValueError(str(exc)) from exc
        return value.strip()


class RepositoryOut(ORMModel):
    id: uuid.UUID
    installation_id: uuid.UUID | None = None
    connection_id: uuid.UUID | None = None
    workspace_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    repo_id: int
    repo_full_name: str
    default_branch: str
    is_active: bool
    connected_by: uuid.UUID | None = None
    created_at: datetime


class PersonalRepoLinkBody(BaseModel):
    """Link one of the caller's own repos to a project, operated by their personal token."""

    project_id: uuid.UUID
    repo_full_name: str = Field(min_length=1, max_length=300)

    @field_validator("repo_full_name")
    @classmethod
    def validate_repo_full_name(cls, value: str) -> str:
        try:
            parse_repo_full_name(value.strip())
        except GitHubPathValidationError as exc:
            raise ValueError(str(exc)) from exc
        return value.strip()


class PersonalRepoLinkOut(BaseModel):
    """A repo the caller linked to a project via their personal connection."""

    id: uuid.UUID
    repo_full_name: str
    project_id: uuid.UUID
    project_name: str
    connected_by: uuid.UUID | None = None


class SyncIssuesOut(BaseModel):
    imported: int
    status_synced: int = 0


class IssueStatusSyncOut(BaseModel):
    updated: bool
    status_id: str | None = None


class SubIssuesSyncOut(BaseModel):
    imported: int = 0


class IssueCommentsSyncOut(BaseModel):
    imported: int = 0


# --------------------------------------------------------------------------
# Task commands (personal connection)
# --------------------------------------------------------------------------

class IssueOut(BaseModel):
    issue_number: int
    issue_url: str


def _clean_optional_repo_full_name(value: str | None) -> str | None:
    """Validate an optional ``owner/name`` repo identifier (personal-repo target)."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        parse_repo_full_name(value)
    except GitHubPathValidationError as exc:
        raise ValueError(str(exc)) from exc
    return value


class IssueCreateBody(BaseModel):
    """Optional target repo for a task issue.

    Either a project-linked repo (``repository_id``) or one of the caller's own
    accessible repos (``repo_full_name``). Both omitted falls back to the single
    repo linked to the task's project.
    """

    repository_id: uuid.UUID | None = None
    repo_full_name: str | None = Field(default=None, max_length=300)

    @field_validator("repo_full_name")
    @classmethod
    def _validate_repo(cls, value: str | None) -> str | None:
        return _clean_optional_repo_full_name(value)


class IssueCommentBody(BaseModel):
    body: str = Field(min_length=1, max_length=65536)


class BranchNameOut(BaseModel):
    branch_name: str


class BranchCreateBody(BaseModel):
    repository_id: uuid.UUID | None = None
    repo_full_name: str | None = Field(default=None, max_length=300)
    branch_name: str | None = Field(default=None, max_length=255)

    @field_validator("repo_full_name")
    @classmethod
    def _validate_repo(cls, value: str | None) -> str | None:
        return _clean_optional_repo_full_name(value)

    @field_validator("branch_name")
    @classmethod
    def validate_branch(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            return validate_branch_name(value.strip())
        except GitHubPathValidationError as exc:
            raise ValueError(str(exc)) from exc


class BranchOut(BaseModel):
    branch: str
    url: str


class PullRequestCreateBody(BaseModel):
    repository_id: uuid.UUID | None = None
    repo_full_name: str | None = Field(default=None, max_length=300)
    head: str = Field(min_length=1, max_length=255)
    base: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=255)

    @field_validator("repo_full_name")
    @classmethod
    def _validate_repo(cls, value: str | None) -> str | None:
        return _clean_optional_repo_full_name(value)

    @field_validator("head", "base")
    @classmethod
    def validate_branch_refs(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            return validate_branch_name(value.strip())
        except GitHubPathValidationError as exc:
            raise ValueError(str(exc)) from exc


class PullRequestOut(BaseModel):
    number: int
    url: str


class TaskPullRequestOut(BaseModel):
    number: int
    url: str
    title: str
    state: str
    merged: bool


class PullRequestActionBody(BaseModel):
    repository_id: uuid.UUID | None = None


# --------------------------------------------------------------------------
# Connected search
# --------------------------------------------------------------------------

class CodeSearchItem(BaseModel):
    name: str
    path: str
    repo_full_name: str
    url: str


class CodeSearchOut(BaseModel):
    connected: bool
    items: list[CodeSearchItem] = []


# --------------------------------------------------------------------------
# Events
# --------------------------------------------------------------------------

class GithubEventOut(ORMModel):
    id: uuid.UUID
    repository_id: uuid.UUID
    event_type: str
    action: str | None = None
    actor_login: str | None = None
    payload: dict
    task_id: uuid.UUID | None = None
    created_at: datetime
