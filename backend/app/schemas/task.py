import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.project import CustomStatusOut
from app.schemas.user import UserBrief

PRIORITY_PATTERN = "^(urgent|high|normal|low)$"
TASK_TYPE_PATTERN = "^(task|bug|story|epic)$"


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=50000)
    priority: str | None = Field(default=None, pattern=PRIORITY_PATTERN)
    status_id: uuid.UUID | None = None
    task_type: str = Field(default="task", pattern=TASK_TYPE_PATTERN)
    list_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    story_points: int | None = Field(default=None, ge=0, le=1000)
    labels: list[str] = Field(default_factory=list, max_length=20)
    assignee_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=50000)
    priority: str | None = Field(default=None, pattern=PRIORITY_PATTERN)
    clear_priority: bool = False
    status_id: uuid.UUID | None = None
    task_type: str | None = Field(default=None, pattern=TASK_TYPE_PATTERN)
    list_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    clear_due_date: bool = False
    story_points: int | None = Field(default=None, ge=0, le=1000)
    labels: list[str] | None = Field(default=None, max_length=20)
    position: int | None = None
    is_archived: bool | None = None


class TaskOut(ORMModel):
    id: uuid.UUID
    project_id: uuid.UUID
    list_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    number: int
    ref: str = ""
    title: str
    description: str | None = None
    priority: str | None = None
    task_type: str
    start_date: date | None = None
    due_date: date | None = None
    story_points: int | None = None
    position: int
    labels: list[str] = []
    is_archived: bool
    completed_at: datetime | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    status: CustomStatusOut | None = None
    assignees: list[UserBrief] = []
    subtask_count: int = 0
    subtask_done_count: int = 0
    comment_count: int = 0
    github_issue_number: int | None = None
    github_issue_url: str | None = None


class TaskDependencyOut(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    depends_on_task_id: uuid.UUID
    depends_on: TaskOut | None = None


class AttachmentOut(ORMModel):
    id: uuid.UUID
    task_id: uuid.UUID
    file_name: str
    mime_type: str
    size_bytes: int
    uploaded_by: uuid.UUID | None = None
    created_at: datetime
    uploader: UserBrief | None = None


class TaskDetailOut(TaskOut):
    subtasks: list[TaskOut] = []
    dependencies: list[TaskDependencyOut] = []
    dependents: list[TaskDependencyOut] = []
    attachments: list[AttachmentOut] = []
    total_tracked_seconds: int = 0


class AssigneesAdd(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)


class DependencyAdd(BaseModel):
    depends_on_task_id: uuid.UUID


class RecurringTaskCreate(BaseModel):
    frequency: str = Field(pattern="^(daily|weekly|monthly)$")
    interval: int = Field(default=1, ge=1, le=52)
    template: dict = Field(default_factory=dict)
    list_id: uuid.UUID | None = None
    source_task_id: uuid.UUID | None = None
    next_occurrence_at: datetime


class RecurringTaskOut(ORMModel):
    id: uuid.UUID
    project_id: uuid.UUID
    frequency: str
    interval: int
    template: dict
    next_occurrence_at: datetime
    last_created_at: datetime | None = None
    is_active: bool
