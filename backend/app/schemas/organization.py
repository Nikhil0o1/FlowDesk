import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.email_validation import InviteEmail
from app.core.json_limits import JsonPayloadTooDeep, JsonPayloadTooLarge, validate_json_payload
from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class OrganizationOut(ORMModel):
    id: uuid.UUID
    name: str
    logo_url: str | None = None
    is_disabled: bool
    require_2fa: bool = False
    created_at: datetime
    my_role: str | None = None


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    logo_url: str | None = None
    settings: dict | None = None
    require_2fa: bool | None = None

    @field_validator("settings")
    @classmethod
    def validate_settings(cls, value: dict | None) -> dict | None:
        try:
            return validate_json_payload(value, max_bytes=32_768, max_depth=5, label="settings")
        except (JsonPayloadTooLarge, JsonPayloadTooDeep) as exc:
            raise ValueError(str(exc)) from exc


class OrgMemberOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role: str
    created_at: datetime
    user: UserBrief | None = None


class OrgMemberRoleUpdate(BaseModel):
    role: str = Field(pattern="^(admin|member)$")


class WorkspaceAccessItem(BaseModel):
    workspace_id: uuid.UUID
    workspace_name: str
    role: str | None = None


class SpaceAccessItem(BaseModel):
    space_id: uuid.UUID
    space_name: str
    workspace_id: uuid.UUID
    workspace_name: str
    role: str | None = None


class ProjectAccessItem(BaseModel):
    project_id: uuid.UUID
    project_name: str
    workspace_id: uuid.UUID
    workspace_name: str
    space_id: uuid.UUID | None = None
    space_name: str | None = None
    role: str | None = None


class MemberAccessDetail(BaseModel):
    user_id: uuid.UUID
    org_role: str
    highest_role: str
    user: UserBrief | None = None
    workspace_access: list[WorkspaceAccessItem] = []
    space_access: list[SpaceAccessItem] = []
    project_access: list[ProjectAccessItem] = []
    can_manage_org_role: bool = False


class TransferOwnershipRequest(BaseModel):
    new_owner_id: uuid.UUID


class InviteCreate(BaseModel):
    email: InviteEmail
    role: str = Field(default="member", max_length=20)


class InviteOut(ORMModel):
    id: uuid.UUID
    email: str
    scope: str
    role: str
    status: str
    expires_at: datetime
    created_at: datetime
    workspace_id: uuid.UUID | None = None
    space_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None


class OrgInviteGrant(BaseModel):
    """One workspace, space, or project target within an organization bulk invite."""

    scope: Literal["workspace", "space", "project"]
    role: str = Field(max_length=20)
    workspace_id: uuid.UUID | None = None
    space_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def validate_target(self) -> "OrgInviteGrant":
        if self.scope == "workspace":
            if self.workspace_id is None:
                raise ValueError("workspace_id is required for workspace grants")
            if self.space_id is not None or self.project_id is not None:
                raise ValueError("workspace grants must not include space_id or project_id")
            if self.role not in ("admin", "member"):
                raise ValueError("Invalid role for workspace invite")
        elif self.scope == "space":
            if self.space_id is None:
                raise ValueError("space_id is required for space grants")
            if self.workspace_id is not None or self.project_id is not None:
                raise ValueError("space grants must not include workspace_id or project_id")
            if self.role not in ("admin", "member"):
                raise ValueError("Invalid role for space invite")
        elif self.scope == "project":
            if self.project_id is None:
                raise ValueError("project_id is required for project grants")
            if self.workspace_id is not None or self.space_id is not None:
                raise ValueError("project grants must not include workspace_id or space_id")
            if self.role not in ("admin", "member", "viewer"):
                raise ValueError("Invalid role for project invite")
        return self


class OrganizationBulkInviteCreate(BaseModel):
    email: InviteEmail
    grants: list[OrgInviteGrant] = Field(min_length=1, max_length=30)


class OrganizationBulkInviteOut(BaseModel):
    invites: list[InviteOut]
    skipped: list[str] = Field(default_factory=list)


class AuditLogOut(ORMModel):
    id: uuid.UUID
    action: str
    actor_id: uuid.UUID | None = None
    target_type: str | None = None
    target_id: str | None = None
    data: dict
    created_at: datetime
    actor: UserBrief | None = None
