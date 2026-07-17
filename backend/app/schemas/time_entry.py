import uuid
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field, model_validator

from app.core.config import settings
from app.schemas.common import ORMModel
from app.schemas.user import UserBrief

_CLOCK_SKEW = timedelta(minutes=2)


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
        now = datetime.now(timezone.utc)
        started = self.started_at if self.started_at.tzinfo else self.started_at.replace(tzinfo=timezone.utc)
        ended = self.ended_at if self.ended_at.tzinfo else self.ended_at.replace(tzinfo=timezone.utc)
        if ended > now + _CLOCK_SKEW:
            raise ValueError("ended_at cannot be in the future")
        if started > now + _CLOCK_SKEW:
            raise ValueError("started_at cannot be in the future")
        duration_hours = (ended - started).total_seconds() / 3600
        if duration_hours > settings.MAX_MANUAL_ENTRY_HOURS:
            raise ValueError(
                f"Time entry cannot exceed {settings.MAX_MANUAL_ENTRY_HOURS} hours"
            )
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
