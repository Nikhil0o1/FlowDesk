import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class WhiteboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class WhiteboardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    content: dict | None = None


class WhiteboardListOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    element_count: int = 0
    creator: UserBrief | None = None


class WhiteboardOut(WhiteboardListOut):
    content: dict = {}
