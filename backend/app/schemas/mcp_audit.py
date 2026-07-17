import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class McpAuditLogIn(BaseModel):
    tool: str = Field(min_length=1, max_length=120)
    args_hash: str = Field(min_length=64, max_length=64)
    status: str = Field(pattern="^(ok|error)$")
    http_status: int | None = Field(default=None, ge=100, le=599)
    resource_ids: list[str] = Field(default_factory=list, max_length=25)
    error_message: str | None = Field(default=None, max_length=2000)
    duration_ms: int | None = Field(default=None, ge=0, le=600_000)


class McpAuditLogOut(ORMModel):
    id: uuid.UUID
    tool: str
    status: str
    http_status: int | None
    resource_ids: list[str]
    error_message: str | None
    duration_ms: int | None
    created_at: datetime
    token_prefix: str | None = None
