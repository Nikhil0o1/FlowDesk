import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.email_validation import InviteEmail
from app.schemas.common import ORMModel
from app.schemas.organization import InviteOut
from app.schemas.user import UserBrief


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    color: str = Field(default="#8C5BFF", max_length=20)
    icon: str | None = Field(default=None, max_length=40)


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=40)


class WorkspaceOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    description: str | None = None
    color: str
    icon: str | None = None
    is_archived: bool
    created_at: datetime
    my_role: str | None = None


class WorkspaceMemberOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    created_at: datetime
    user: UserBrief | None = None


class WorkspaceMemberRoleUpdate(BaseModel):
    role: str = Field(pattern="^(admin|member)$")


class WorkspaceMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: str = Field(default="member", pattern="^(admin|member)$")


class WorkspaceMembershipBrief(BaseModel):
    workspace_id: uuid.UUID
    workspace_name: str
    role: str


class SpaceMembershipBrief(BaseModel):
    space_id: uuid.UUID
    space_name: str
    role: str


class ProjectMembershipBrief(BaseModel):
    project_id: uuid.UUID
    project_name: str
    # Projects can live directly under a workspace (e.g. personal lists), with no space.
    space_id: uuid.UUID | None = None
    role: str


class WorkspaceMemberCandidateOut(BaseModel):
    user_id: uuid.UUID
    user: UserBrief | None = None
    org_role: str = "member"
    workspaces: list[WorkspaceMembershipBrief] = []
    spaces: list[SpaceMembershipBrief] = []
    projects: list[ProjectMembershipBrief] = []


class WorkspaceInviteCreate(BaseModel):
    email: InviteEmail
    role: str = Field(default="member", pattern="^(admin|member)$")


class ScopedInviteGrant(BaseModel):
    """One space or project target within a workspace bulk invite."""

    scope: Literal["space", "project"]
    role: str = Field(max_length=20)
    space_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def validate_target(self) -> "ScopedInviteGrant":
        if self.scope == "space":
            if self.space_id is None:
                raise ValueError("space_id is required for space grants")
            if self.project_id is not None:
                raise ValueError("project_id must be omitted for space grants")
            if self.role not in ("admin", "member"):
                raise ValueError("Invalid role for space invite")
        elif self.scope == "project":
            if self.project_id is None:
                raise ValueError("project_id is required for project grants")
            if self.space_id is not None:
                raise ValueError("space_id must be omitted for project grants")
            if self.role not in ("admin", "member", "viewer"):
                raise ValueError("Invalid role for project invite")
        return self


class WorkspaceBulkInviteCreate(BaseModel):
    email: InviteEmail
    grants: list[ScopedInviteGrant] = Field(min_length=1, max_length=30)


class WorkspaceBulkInviteOut(BaseModel):
    invites: list[InviteOut]
    skipped: list[str] = Field(default_factory=list)


class StatusCount(BaseModel):
    name: str
    color: str
    count: int


class WorkspaceTaskStats(BaseModel):
    total: int
    by_status: list[StatusCount]
