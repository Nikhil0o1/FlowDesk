import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.core.json_limits import JsonPayloadTooDeep, JsonPayloadTooLarge, validate_json_payload

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
    planned_start_at: datetime | None = None
    planned_end_at: datetime | None = None
    sync_to_google: bool = False
    create_github_issue: bool = False
    story_points: int | None = Field(default=None, ge=0, le=1000)
    labels: list[str] = Field(default_factory=list, max_length=20)
    assignee_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    time_estimate_seconds: int | None = Field(default=None, ge=0, le=30 * 24 * 3600)  # up to 30 days


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
    clear_start_date: bool = False
    clear_due_date: bool = False
    planned_start_at: datetime | None = None
    planned_end_at: datetime | None = None
    clear_planned_times: bool = False
    story_points: int | None = Field(default=None, ge=0, le=1000)
    labels: list[str] | None = Field(default=None, max_length=20)
    position: int | None = None
    is_archived: bool | None = None
    time_estimate_seconds: int | None = Field(default=None, ge=0, le=30 * 24 * 3600)
    clear_time_estimate: bool = False
    parent_task_id: uuid.UUID | None = None  # set to nest as a subtask
    clear_parent: bool = False  # promote a subtask back to a top-level task
    force_complete_subtasks: bool = False  # allow completing parent with open subtasks

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
    planned_start_at: datetime | None = None
    planned_end_at: datetime | None = None
    google_calendar_event_id: str | None = None
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
    time_estimate_seconds: int | None = None
    is_private: bool = False


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


class ChecklistItemOut(ORMModel):
    id: uuid.UUID
    content: str
    is_done: bool
    position: int


class ChecklistOut(ORMModel):
    id: uuid.UUID
    name: str
    position: int
    items: list[ChecklistItemOut] = []


class CustomFieldValueOut(BaseModel):
    field_id: uuid.UUID
    value: dict = {}


class TaskDetailOut(TaskOut):
    subtasks: list[TaskOut] = []
    dependencies: list[TaskDependencyOut] = []
    dependents: list[TaskDependencyOut] = []
    attachments: list[AttachmentOut] = []
    total_tracked_seconds: int = 0
    checklists: list[ChecklistOut] = []
    custom_fields: list[CustomFieldValueOut] = []


# --------------------------------------------------------------------------
# Sharing
# --------------------------------------------------------------------------

class TaskShareMemberOut(BaseModel):
    user_id: uuid.UUID
    role: str
    user: UserBrief | None = None


class TaskShareState(BaseModel):
    is_private: bool
    public_enabled: bool
    public_token: str | None = None
    public_url: str | None = None
    public_expires_at: datetime | None = None
    public_searchable: bool = False
    members: list[TaskShareMemberOut] = []


class ShareMemberRoleUpdate(BaseModel):
    role: str = Field(pattern="^(editor|viewer)$")


class TaskShareUpdate(BaseModel):
    is_private: bool | None = None
    public_enabled: bool | None = None
    public_expires_at: datetime | None = None
    clear_public_expiry: bool = False
    public_searchable: bool | None = None


class ShareMemberAdd(BaseModel):
    user_id: uuid.UUID | None = None
    email: str | None = Field(default=None, max_length=255)
    role: str = Field(default="editor", pattern="^(editor|viewer)$")


# --------------------------------------------------------------------------
# Checklists
# --------------------------------------------------------------------------

class ChecklistCreate(BaseModel):
    name: str = Field(default="Checklist", min_length=1, max_length=200)


class ChecklistUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ChecklistItemCreate(BaseModel):
    content: str = Field(min_length=1, max_length=1000)


class ChecklistItemUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=1000)
    is_done: bool | None = None
    position: int | None = None


# --------------------------------------------------------------------------
# Custom fields
# --------------------------------------------------------------------------

class CustomFieldDefOut(ORMModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    field_type: str
    options: list = []
    position: int


class CustomFieldDefCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    field_type: str = Field(default="text", pattern="^(text|number|date|select|checkbox)$")
    options: list[str] = Field(default_factory=list, max_length=50)


class CustomFieldDefUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    options: list[str] | None = None
    position: int | None = None


class CustomFieldValueSet(BaseModel):
    value: dict = Field(default_factory=dict)  # {"v": <text|number|date|bool|option>}

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: dict) -> dict:
        try:
            return validate_json_payload(value, max_bytes=16_384, max_depth=5, label="value") or {}
        except (JsonPayloadTooLarge, JsonPayloadTooDeep) as exc:
            raise ValueError(str(exc)) from exc


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


class MyTasksSummaryOut(BaseModel):
    today: int
    overdue: int
    today_and_overdue: int
    next: int
    unscheduled: int
