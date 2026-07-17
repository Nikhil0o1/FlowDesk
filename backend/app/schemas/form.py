import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.form import FORM_FIELD_TYPES
from app.schemas.common import ORMModel

MAX_FIELDS = 25


def _validate_fields(fields: list) -> list:
    if not isinstance(fields, list) or len(fields) == 0:
        raise ValueError("A form needs at least one field")
    if len(fields) > MAX_FIELDS:
        raise ValueError(f"A form can have at most {MAX_FIELDS} fields")
    seen_ids: set[str] = set()
    for field in fields:
        if not isinstance(field, dict):
            raise ValueError("Each field must be an object")
        fid = str(field.get("id", "")).strip()
        ftype = field.get("type")
        label = str(field.get("label", "")).strip()
        if not fid or fid in seen_ids:
            raise ValueError("Each field needs a unique id")
        seen_ids.add(fid)
        if ftype not in FORM_FIELD_TYPES:
            raise ValueError(f"Unknown field type: {ftype}")
        if not label:
            raise ValueError("Each field needs a label")
        if ftype in ("select", "checklist") and not isinstance(field.get("options"), list):
            raise ValueError(f"{ftype.capitalize()} fields need an options list")
        if ftype in ("select", "checklist"):
            opts = field.get("options") or []
            if not opts or not all(str(o).strip() for o in opts):
                raise ValueError(f"{ftype.capitalize()} fields need at least one non-empty option")
    first = fields[0]
    if first.get("type") != "text":
        raise ValueError("The first field must be a text field (task name)")
    return fields


class FormCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    project_id: uuid.UUID


class FormUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    fields: list | None = None
    is_active: bool | None = None

    @field_validator("fields")
    @classmethod
    def check_fields(cls, v):
        if v is None:
            return v
        return _validate_fields(v)


class FormOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str | None = None
    fields: list = []
    public_token: str
    is_active: bool
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    submission_count: int = 0
    project_name: str | None = None


class FormSubmissionOut(ORMModel):
    id: uuid.UUID
    form_id: uuid.UUID
    task_id: uuid.UUID | None = None
    data: dict
    submitter_email: str | None = None
    created_at: datetime
    task_ref: str | None = None


class PublicFormOut(BaseModel):
    name: str
    description: str | None = None
    fields: list
    workspace_name: str
    is_active: bool = True


class PublicSubmission(BaseModel):
    values: dict = Field(default_factory=dict)
    submitter_email: str | None = Field(default=None, max_length=320)
    captcha_token: str | None = Field(default=None, max_length=4096)
    # Honeypot — must stay empty; bots that fill it are silently dropped.
    website: str | None = Field(default=None, max_length=200)
