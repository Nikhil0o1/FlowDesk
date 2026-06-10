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


class SprintUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=4000)
    start_date: date | None = None
    end_date: date | None = None
    scrum_master_id: uuid.UUID | None = None


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
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    scrum_master: UserBrief | None = None
    task_count: int = 0
    total_points: int = 0
    completed_points: int = 0


class SprintTaskAdd(BaseModel):
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


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


class StandupOut(ORMModel):
    id: uuid.UUID
    sprint_id: uuid.UUID
    user_id: uuid.UUID
    for_date: date
    yesterday: str | None = None
    today: str | None = None
    blockers: str | None = None
    created_at: datetime
    user: UserBrief | None = None
