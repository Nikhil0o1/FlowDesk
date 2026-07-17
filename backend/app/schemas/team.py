import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    color: str = Field(default="#8C5BFF", max_length=20)
    member_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None, max_length=20)


class TeamMemberOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    created_at: datetime
    user: UserBrief | None = None


class TeamOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str | None = None
    color: str
    created_by: uuid.UUID | None = None
    created_at: datetime
    members: list[UserBrief] = []
    member_details: list[TeamMemberOut] = []
    my_role: str | None = None
    can_manage_members: bool = False
    can_delete: bool = False
    can_create_teams: bool = False


class TeamMembersAdd(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    role: str = Field(default="member", pattern="^(admin|member)$")


class TeamMemberRoleUpdate(BaseModel):
    role: str = Field(pattern="^(admin|member)$")
