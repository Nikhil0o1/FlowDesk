import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class SprintCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=4000)
    project_id: uuid.UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    scrum_master_id: uuid.UUID | None = None
    delegate_scrum_master_id: uuid.UUID | None = None
    scope_locked: bool = False


class SprintUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=4000)
    start_date: date | None = None
    end_date: date | None = None
    scrum_master_id: uuid.UUID | None = None
    delegate_scrum_master_id: uuid.UUID | None = None
    scope_locked: bool | None = None


class SprintTaskMove(BaseModel):
    target_sprint_id: uuid.UUID


class SprintOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None = None
    name: str
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: str
    scrum_master_id: uuid.UUID | None = None
    delegate_scrum_master_id: uuid.UUID | None = None
    scope_locked: bool = False
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    scrum_master: UserBrief | None = None
    delegate_scrum_master: UserBrief | None = None
    task_count: int = 0
    total_points: int = 0
    completed_points: int = 0


class SprintTaskAdd(BaseModel):
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class SprintCompleteRequest(BaseModel):
    """Optional rollover: move unfinished tasks into another sprint on completion."""
    move_incomplete_to: uuid.UUID | None = None


class BurndownPoint(BaseModel):
    day: date
    remaining_points: int
    ideal_points: float


class SprintBurndownOut(BaseModel):
    sprint_id: uuid.UUID
    total_points: int
    completed_points: int
    points: list[BurndownPoint]


class StandupCreate(BaseModel):
    for_date: date
    yesterday: str | None = Field(default=None, max_length=4000)
    today: str | None = Field(default=None, max_length=4000)
    blockers: str | None = Field(default=None, max_length=4000)


class StandupFollowUpCreate(BaseModel):
    task_id: uuid.UUID
    body: str = Field(min_length=1, max_length=8000)


class StandupOut(ORMModel):
    id: uuid.UUID
    sprint_id: uuid.UUID
    user_id: uuid.UUID
    for_date: date
    yesterday: str | None = None
    today: str | None = None
    blockers: str | None = None
    blocker_resolved_at: datetime | None = None
    blocker_resolved_by: uuid.UUID | None = None
    created_at: datetime
    user: UserBrief | None = None
    blocker_resolver: UserBrief | None = None


class SprintChangeOut(ORMModel):
    id: uuid.UUID
    action: str
    summary: str
    actor: UserBrief | None = None
    data: dict = Field(default_factory=dict)
    created_at: datetime


class SprintSummaryOut(BaseModel):
    sprint_id: uuid.UUID
    sprint_name: str
    total_tasks: int
    completed_tasks: int
    incomplete_tasks: int
    total_points: int
    completed_points: int
    scope_changes: int
    open_blockers: int
    resolved_blockers: int
    incomplete_task_refs: list[str] = Field(default_factory=list)
    pace: str  # ahead | on_track | behind


class SprintCompleteResponse(BaseModel):
    sprint: SprintOut
    summary: SprintSummaryOut


RETRO_ITEM_CATEGORIES = ("rose", "thorn", "bud")


class RetrospectiveUpdate(BaseModel):
    stage_notes: str | None = Field(default=None, max_length=8000)


class RetrospectiveItemCreate(BaseModel):
    category: str = Field(pattern="^(rose|thorn|bud)$")
    body: str = Field(min_length=1, max_length=2000)
    assignee_id: uuid.UUID | None = None


class RetrospectiveItemUpdate(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=2000)
    is_done: bool | None = None
    assignee_id: uuid.UUID | None = None


class RetrospectiveItemOut(ORMModel):
    id: uuid.UUID
    retrospective_id: uuid.UUID
    category: str
    body: str
    author_id: uuid.UUID
    is_done: bool = False
    assignee_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    author: UserBrief | None = None
    assignee: UserBrief | None = None


class RetrospectiveOut(ORMModel):
    id: uuid.UUID
    sprint_id: uuid.UUID
    stage_notes: str | None = None
    created_at: datetime
    updated_at: datetime
    items: list[RetrospectiveItemOut] = Field(default_factory=list)
    summary: SprintSummaryOut | None = None
