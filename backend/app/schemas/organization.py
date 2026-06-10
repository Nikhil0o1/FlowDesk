import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class OrganizationOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    logo_url: str | None = None
    is_disabled: bool
    plan: str
    seats: int
    created_at: datetime
    my_role: str | None = None


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    logo_url: str | None = None
    settings: dict | None = None


class OrgMemberOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    created_at: datetime
    user: UserBrief | None = None


class OrgMemberRoleUpdate(BaseModel):
    role: str = Field(pattern="^(owner|member)$")


class InviteCreate(BaseModel):
    email: EmailStr
    role: str = Field(default="member", max_length=20)


class InviteOut(ORMModel):
    id: uuid.UUID
    email: str
    scope: str
    role: str
    status: str
    expires_at: datetime
    created_at: datetime


class AuditLogOut(ORMModel):
    id: uuid.UUID
    action: str
    actor_id: uuid.UUID | None = None
    target_type: str | None = None
    target_id: str | None = None
    data: dict
    created_at: datetime
    actor: UserBrief | None = None
