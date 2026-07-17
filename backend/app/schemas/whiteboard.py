import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.json_limits import JsonPayloadTooDeep, JsonPayloadTooLarge, validate_json_payload
from app.schemas.common import ORMModel
from app.schemas.user import UserBrief


class WhiteboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # Whiteboards are private to a project — only that project's members can see them.
    project_id: uuid.UUID


class WhiteboardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    content: dict | None = None

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: dict | None) -> dict | None:
        try:
            return validate_json_payload(value, max_bytes=1_048_576, max_depth=15, label="content")
        except (JsonPayloadTooLarge, JsonPayloadTooDeep) as exc:
            raise ValueError(str(exc)) from exc


class WhiteboardListOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    name: str
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    element_count: int = 0
    creator: UserBrief | None = None
    can_delete: bool = False


class WhiteboardOut(WhiteboardListOut):
    content: dict = {}
