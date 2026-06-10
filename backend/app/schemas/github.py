import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


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


class RepositoryOut(ORMModel):
    id: uuid.UUID
    installation_id: uuid.UUID
    workspace_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    repo_id: int
    repo_full_name: str
    default_branch: str
    is_active: bool
    created_at: datetime


class GithubEventOut(ORMModel):
    id: uuid.UUID
    repository_id: uuid.UUID
    event_type: str
    action: str | None = None
    actor_login: str | None = None
    payload: dict
    task_id: uuid.UUID | None = None
    created_at: datetime
