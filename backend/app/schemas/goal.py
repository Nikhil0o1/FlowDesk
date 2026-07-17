import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


def _unique_ids(ids: list[uuid.UUID]) -> list[uuid.UUID]:
    seen: set[uuid.UUID] = set()
    out: list[uuid.UUID] = []
    for uid in ids:
        if uid in seen:
            continue
        seen.add(uid)
        out.append(uid)
    return out


class GoalAccessOut(BaseModel):
    section_access: bool
    explicit_access: bool
    can_access: bool


class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    owner_id: uuid.UUID | None = None
    owner_ids: list[uuid.UUID] | None = None
    start_date: date | None = None
    due_date: date | None = None
    status: str = Field(default="active", pattern="^(draft|active|completed|archived)$")
    is_private: bool = False
    color: str | None = Field(default=None, max_length=32)
    folder_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def resolve_owners(self) -> "GoalCreate":
        ids = _unique_ids(self.owner_ids or ([self.owner_id] if self.owner_id else []))
        if not ids:
            raise ValueError("At least one owner is required")
        self.owner_ids = ids
        self.owner_id = ids[0]
        return self


class GoalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    owner_id: uuid.UUID | None = None
    owner_ids: list[uuid.UUID] | None = None
    start_date: date | None = None
    due_date: date | None = None
    status: str | None = Field(default=None, pattern="^(draft|active|completed|archived)$")
    is_private: bool | None = None
    color: str | None = Field(default=None, max_length=32)
    folder_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def resolve_owners(self) -> "GoalUpdate":
        if self.owner_ids is not None:
            ids = _unique_ids(self.owner_ids)
            if not ids:
                raise ValueError("At least one owner is required")
            self.owner_ids = ids
            self.owner_id = ids[0]
        return self


class GoalOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str | None = None
    owner_id: uuid.UUID
    status: str
    progress: Decimal
    start_date: date | None = None
    due_date: date | None = None
    is_private: bool = False
    share_token: str | None = None
    color: str | None = None
    folder_id: uuid.UUID | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    display_order: int = 0
    owner: UserBrief | None = None
    created_by_user: UserBrief | None = None
    owners: list[UserBrief] = Field(default_factory=list)
    target_count: int = 0


class GoalFolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    color: str | None = Field(default=None, max_length=32)
    is_private: bool = False


class GoalFolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    color: str | None = Field(default=None, max_length=32)
    is_private: bool | None = None
    is_archived: bool | None = None


class GoalFolderOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str | None = None
    color: str | None = None
    is_private: bool = False
    is_archived: bool = False
    archived_at: datetime | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    goal_count: int = 0
    progress: Decimal = Decimal("0")
    active_count: int = 0
    completed_count: int = 0
    archived_count: int = 0
    draft_count: int = 0
    created_by_user: UserBrief | None = None


class GoalFolderDetailOut(GoalFolderOut):
    goals: list[GoalOut] = Field(default_factory=list)


class GoalFolderShareMemberOut(BaseModel):
    user_id: uuid.UUID
    role: str
    user: UserBrief | None = None


class GoalFolderShareState(BaseModel):
    folder_id: uuid.UUID
    is_private: bool
    members: list[GoalFolderShareMemberOut] = Field(default_factory=list)


class GoalFolderShareUpdate(BaseModel):
    is_private: bool | None = None


class GoalFolderShareMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: str = Field(default="viewer", pattern="^(editor|viewer)$")


class GoalFolderShareMemberUpdate(BaseModel):
    role: str = Field(pattern="^(editor|viewer)$")


class GoalFolderAnalyticsOut(BaseModel):
    folder_id: uuid.UUID
    name: str
    progress: Decimal
    goal_count: int
    active_count: int
    completed_count: int
    archived_count: int
    draft_count: int
    # Progress averaged over non-archived goals only
    tracked_goal_count: int = 0
    # Simple distribution buckets for progress cards
    not_started_count: int = 0  # progress == 0 (non-archived)
    in_progress_count: int = 0  # 0 < progress < 100
    at_risk_count: int = 0  # active with due_date in the past and progress < 100



class GoalMove(BaseModel):
    folder_id: uuid.UUID | None = None


class GoalReorder(BaseModel):
    """Ordered goal ids for a workspace scope (root or one folder)."""

    goal_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    folder_id: uuid.UUID | None = None


class GoalTaskLinkOut(BaseModel):
    task_id: uuid.UUID
    goal_id: uuid.UUID
    goal_name: str
    target_id: uuid.UUID
    target_title: str


class GoalTargetTaskAdd(BaseModel):
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class GoalTargetSprintAdd(BaseModel):
    sprint_id: uuid.UUID


class GoalTargetSprintOut(BaseModel):
    sprint_id: uuid.UUID
    name: str
    status: str
    task_count: int = 0
    start_date: date | None = None
    end_date: date | None = None


class GoalTargetCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    owner_id: uuid.UUID | None = None
    owner_ids: list[uuid.UUID] | None = None
    target_type: str = Field(default="tasks", pattern="^(tasks|number|currency|true_false)$")
    start_value: Decimal | None = None
    target_value: Decimal | None = None
    current_value: Decimal | None = None
    is_completed: bool = False

    @model_validator(mode="after")
    def validate_type_fields(self) -> "GoalTargetCreate":
        ids = _unique_ids(self.owner_ids or ([self.owner_id] if self.owner_id else []))
        if not ids:
            raise ValueError("At least one owner is required")
        self.owner_ids = ids
        self.owner_id = ids[0]
        if self.target_type in ("number", "currency"):
            start = self.start_value if self.start_value is not None else Decimal("0")
            target = self.target_value if self.target_value is not None else Decimal("1")
            if target == start:
                raise ValueError("Target value must differ from start value")
            self.start_value = start
            self.target_value = target
            if self.current_value is None:
                self.current_value = start
        return self


class GoalTargetUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    owner_id: uuid.UUID | None = None
    owner_ids: list[uuid.UUID] | None = None
    display_order: int | None = Field(default=None, ge=0)
    start_value: Decimal | None = None
    target_value: Decimal | None = None
    current_value: Decimal | None = None
    is_completed: bool | None = None

    @model_validator(mode="after")
    def resolve_owners(self) -> "GoalTargetUpdate":
        if self.owner_ids is not None:
            ids = _unique_ids(self.owner_ids)
            if not ids:
                raise ValueError("At least one owner is required")
            self.owner_ids = ids
            self.owner_id = ids[0]
        return self


class GoalTargetOut(ORMModel):
    id: uuid.UUID
    goal_id: uuid.UUID
    title: str
    owner_id: uuid.UUID | None = None
    target_type: str = "tasks"
    start_value: Decimal | None = None
    target_value: Decimal | None = None
    current_value: Decimal | None = None
    is_completed: bool = False
    progress: Decimal
    display_order: int
    created_at: datetime
    updated_at: datetime
    linked_task_count: int = 0
    owner: UserBrief | None = None
    owners: list[UserBrief] = Field(default_factory=list)


class GoalDetailOut(GoalOut):
    targets: list[GoalTargetOut] = Field(default_factory=list)


class GoalTargetProgressOut(BaseModel):
    id: uuid.UUID
    title: str
    progress: Decimal
    target_type: str = "tasks"
    linked_task_count: int = 0


class GoalProgressOut(BaseModel):
    goal_id: uuid.UUID
    progress: Decimal
    targets: list[GoalTargetProgressOut] = Field(default_factory=list)


class GoalShareMemberOut(BaseModel):
    user_id: uuid.UUID
    role: str
    user: UserBrief | None = None


class GoalShareState(BaseModel):
    goal_id: uuid.UUID
    is_private: bool
    share_token: str | None = None
    share_url: str | None = None
    workspace_shared: bool
    members: list[GoalShareMemberOut] = Field(default_factory=list)


class GoalShareUpdate(BaseModel):
    is_private: bool | None = None


class GoalShareMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: str = Field(default="viewer", pattern="^(editor|viewer)$")
