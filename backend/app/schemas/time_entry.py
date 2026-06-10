import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class TimerStart(BaseModel):
    description: str | None = Field(default=None, max_length=2000)


class ManualTimeEntry(BaseModel):
    started_at: datetime
    ended_at: datetime
    description: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def check_range(self):
        if self.ended_at <= self.started_at:
            raise ValueError("ended_at must be after started_at")
        return self


class TimeEntryOut(ORMModel):
    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None = None
    duration_seconds: int | None = None
    description: str | None = None
    is_manual: bool
    stopped_by_system: bool
    created_at: datetime
    user: UserBrief | None = None
    task_title: str | None = None
    task_ref: str | None = None
