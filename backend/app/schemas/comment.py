import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=20000)
    parent_comment_id: uuid.UUID | None = None


class CommentUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=20000)


class CommentOut(ORMModel):
    id: uuid.UUID
    task_id: uuid.UUID
    author_id: uuid.UUID
    parent_comment_id: uuid.UUID | None = None
    body: str
    created_at: datetime
    updated_at: datetime
    author: UserBrief | None = None
    reply_count: int = 0


class NotificationOut(ORMModel):
    id: uuid.UUID
    type: str
    title: str
    body: str | None = None
    data: dict
    read_at: datetime | None = None
    workspace_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    created_at: datetime
