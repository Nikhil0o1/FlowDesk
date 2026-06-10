import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel


class ProfileOut(ORMModel):
    full_name: str
    avatar_url: str | None = None
    avatar_color: str | None = None
    status_text: str | None = None
    title: str | None = None
    timezone: str = "UTC"
    phone: str | None = None
    about: str | None = None


class UserOut(ORMModel):
    id: uuid.UUID
    email: EmailStr
    is_active: bool
    is_platform_superadmin: bool
    auth_provider: str
    last_login_at: datetime | None = None
    created_at: datetime
    profile: ProfileOut | None = None


class UserBrief(ORMModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str = ""
    avatar_url: str | None = None
    avatar_color: str | None = None


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    title: str | None = Field(default=None, max_length=120)
    timezone: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    about: str | None = Field(default=None, max_length=2000)
    avatar_url: str | None = None
    avatar_color: str | None = Field(default=None, max_length=20)
    status_text: str | None = Field(default=None, max_length=140)
    clear_status: bool = False
