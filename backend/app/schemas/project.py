import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class SpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="#4F8BFF", max_length=20)
    icon: str | None = Field(default=None, max_length=40)


class SpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=40)
    position: int | None = None


class SpaceOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    color: str
    icon: str | None = None
    position: int
    created_at: datetime


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    key: str = Field(min_length=2, max_length=10, pattern="^[A-Za-z][A-Za-z0-9]*$")
    description: str | None = Field(default=None, max_length=4000)
    color: str = Field(default="#9B59B6", max_length=20)
    icon: str | None = Field(default=None, max_length=40)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=40)
    is_archived: bool | None = None


class ProjectOut(ORMModel):
    id: uuid.UUID
    space_id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    key: str
    description: str | None = None
    color: str
    icon: str | None = None
    position: int
    is_archived: bool
    created_at: datetime
    my_role: str | None = None
    task_count: int | None = None
    done_task_count: int | None = None


class ProjectMemberOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    created_at: datetime
    user: UserBrief | None = None


class ProjectMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: str = Field(default="member", pattern="^(admin|member|viewer)$")


class ProjectInviteCreate(BaseModel):
    email: str
    role: str = Field(default="member", pattern="^(admin|member|viewer)$")


class TaskListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class TaskListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    position: int | None = None


class TaskListOut(ORMModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    position: int
    created_at: datetime


class CustomStatusCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(default="#87909E", max_length=20)
    category: str = Field(default="todo", pattern="^(todo|in_progress|done|cancelled)$")


class CustomStatusUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = Field(default=None, max_length=20)
    category: str | None = Field(default=None, pattern="^(todo|in_progress|done|cancelled)$")
    position: int | None = None


class CustomStatusOut(ORMModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    color: str
    category: str
    position: int


class ActivityOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    actor_id: uuid.UUID | None = None
    action: str
    data: dict
    created_at: datetime
    actor: UserBrief | None = None
