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
    github_comment_id: int | None = None
    github_author_login: str | None = None
    created_at: datetime
    updated_at: datetime
    author: UserBrief | None = None
    reply_count: int = 0


class AssignedItemOut(BaseModel):
    """A comment/message @mention surfaced on the Assigned Comments page.

    Unifies task-comment mentions (`source="task"`) and chat mentions
    (`source="chat"`) so the page can filter across both sources.
    """

    id: uuid.UUID  # mention id
    source: str  # "task" | "chat"
    title: str  # task title or channel name
    ref: str | None = None  # task ref (tasks only)
    context: str = ""  # project name (task) or "Chat"
    preview: str
    url: str  # in-app route to open the item
    person: UserBrief | None = None  # assigner (assigned to me) / assignee (delegated by me)
    at: datetime
    priority: str | None = None
    status: str = "pending"


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
