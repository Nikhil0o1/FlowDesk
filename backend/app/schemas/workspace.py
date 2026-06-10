import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    color: str = Field(default="#8C5BFF", max_length=20)
    icon: str | None = Field(default=None, max_length=40)


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=40)


class WorkspaceOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    description: str | None = None
    color: str
    icon: str | None = None
    is_archived: bool
    created_at: datetime
    my_role: str | None = None


class WorkspaceMemberOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    created_at: datetime
    user: UserBrief | None = None


class WorkspaceMemberRoleUpdate(BaseModel):
    role: str = Field(pattern="^(admin|member)$")


class WorkspaceInviteCreate(BaseModel):
    email: str
    role: str = Field(default="member", pattern="^(admin|member)$")


class StatusCount(BaseModel):
    name: str
    color: str
    count: int


class WorkspaceTaskStats(BaseModel):
    total: int
    by_status: list[StatusCount]
