import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief

KIND_PATTERN = "^(project|space)$"
VISIBILITY_PATTERN = "^(workspace|admins|private)$"


class TemplateSaveRequest(BaseModel):
    """Save a live Space or Project as a reusable template."""

    kind: str = Field(pattern=KIND_PATTERN)
    source_id: uuid.UUID  # project id or space id, depending on kind
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    tags: list[str] = Field(default_factory=list)
    visibility: str = Field(default="workspace", pattern=VISIBILITY_PATTERN)
    include_tasks: bool = True


class TemplateUpdateRequest(BaseModel):
    """Edit a template's metadata, and/or re-snapshot it from a source object."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = None
    visibility: str | None = Field(default=None, pattern=VISIBILITY_PATTERN)
    resync_from_source_id: uuid.UUID | None = None  # re-capture structure from this source
    include_tasks: bool = True


class TemplateApplyRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    target_space_id: uuid.UUID | None = None  # required for project templates


class TemplateApplyPayloadRequest(BaseModel):
    """Apply an app-shipped (not DB-stored) starter template payload."""

    kind: str = Field(pattern=KIND_PATTERN)
    name: str = Field(min_length=1, max_length=200)
    payload: dict
    target_space_id: uuid.UUID | None = None  # required for project kind
    workspace_id: uuid.UUID | None = None  # required for space kind


class TemplateIncludes(BaseModel):
    statuses: int = 0
    custom_fields: int = 0
    lists: int = 0
    tasks: int = 0
    projects: int = 0


class TemplateOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    kind: str
    name: str
    description: str | None = None
    color: str
    icon: str | None = None
    tags: list[str] = Field(default_factory=list)
    visibility: str
    usage_count: int
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    includes: TemplateIncludes | None = None
    creator: UserBrief | None = None


class TemplateApplyResult(BaseModel):
    kind: str
    space_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    name: str
