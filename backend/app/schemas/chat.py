import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_private: bool = False
    project_id: uuid.UUID | None = None
    member_ids: list[uuid.UUID] = Field(default_factory=list)


class ChannelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class ChannelOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None = None
    name: str
    description: str | None = None
    is_private: bool
    is_direct: bool
    created_at: datetime
    member_count: int = 0
    unread_count: int = 0
    last_message_at: datetime | None = None


class ChatMemberOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    user: UserBrief | None = None


class ChatMemberAdd(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)
    parent_message_id: uuid.UUID | None = None


class MessageOut(ORMModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    author_id: uuid.UUID
    parent_message_id: uuid.UUID | None = None
    body: str
    edited_at: datetime | None = None
    created_at: datetime
    author: UserBrief | None = None


class MarkReadRequest(BaseModel):
    message_id: uuid.UUID
