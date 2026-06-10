import re
import secrets
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.models.form import Form, FormSubmission
from app.models.organization import Organization
from app.models.project import Project
from app.models.task import Task
from app.models.workspace import Workspace
from app.schemas.common import Message, Page
from app.schemas.form import (
    FormCreate,
    FormOut,
    FormSubmissionOut,
    FormUpdate,
    PublicFormOut,
    PublicSubmission,
)
from app.services import task_service
from app.services.activity_service import log_activity
from app.services.permission_service import PermissionService

router = APIRouter(tags=["forms"])

DEFAULT_FIELDS = [
    {"id": "title", "type": "text", "label": "Task name", "required": True},
    {"id": "details", "type": "textarea", "label": "Describe your request", "required": False},
]

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _form_out(db: Session, form: Form) -> FormOut:
    out = FormOut.model_validate(form)
    out.submission_count = db.scalar(
        select(func.count(FormSubmission.id)).where(FormSubmission.form_id == form.id)
    ) or 0
    project = db.get(Project, form.project_id)
    out.project_name = project.name if project else None
    return out


def _get_form(db: Session, perms: PermissionService, form_id: uuid.UUID) -> Form:
    form = db.get(Form, form_id)
    if not form or form.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Form not found")
    perms.require_workspace_member(form.workspace_id)
    return form


@router.get("/workspaces/{workspace_id}/forms", response_model=list[FormOut])
def list_forms(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    forms = db.scalars(
        select(Form)
        .where(Form.workspace_id == workspace_id, Form.deleted_at.is_(None))
        .order_by(Form.created_at.desc())
    ).all()
    return [_form_out(db, f) for f in forms]


@router.post("/workspaces/{workspace_id}/forms", response_model=FormOut, status_code=201)
def create_form(
    workspace_id: uuid.UUID,
    body: FormCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    project = perms.require_project_edit(body.project_id)
    if project.workspace_id != workspace_id:
        raise HTTPException(status_code=400, detail="Project is not in this workspace")
    form = Form(
        workspace_id=workspace_id,
        project_id=body.project_id,
        name=body.name,
        description=body.description,
        fields=DEFAULT_FIELDS,
        public_token=secrets.token_urlsafe(24),
        created_by=perms.user.id,
    )
    db.add(form)
    db.flush()
    log_activity(db, workspace_id=workspace_id, action="form.created",
                 actor_id=perms.user.id, project_id=body.project_id,
                 data={"form_id": str(form.id), "name": form.name})
    db.commit()
    return _form_out(db, form)


@router.get("/forms/{form_id}", response_model=FormOut)
def get_form(
    form_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return _form_out(db, _get_form(db, perms, form_id))


@router.patch("/forms/{form_id}", response_model=FormOut)
def update_form(
    form_id: uuid.UUID,
    body: FormUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    form = _get_form(db, perms, form_id)
    perms.require_project_edit(form.project_id)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if value is not None:
            setattr(form, field, value)
    db.commit()
    return _form_out(db, form)


@router.delete("/forms/{form_id}", response_model=Message)
def delete_form(
    form_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    form = _get_form(db, perms, form_id)
    if form.created_by != perms.user.id:
        perms.require_project_admin(form.project_id)
    form.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Message(detail="Form deleted")


@router.get("/forms/{form_id}/submissions", response_model=Page[FormSubmissionOut])
def list_submissions(
    form_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    form = _get_form(db, perms, form_id)
    base = select(FormSubmission).where(FormSubmission.form_id == form.id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(FormSubmission.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    project = db.get(Project, form.project_id)
    items = []
    for sub in rows:
        out = FormSubmissionOut.model_validate(sub)
        if sub.task_id and project:
            task = db.get(Task, sub.task_id)
            if task:
                out.task_ref = f"{project.key}-{task.number}"
        items.append(out)
    return Page(items=items, total=total, page=page, page_size=page_size)


# ---------------- Public endpoints (no auth) ----------------

def _public_form(db: Session, token: str) -> Form:
    form = db.scalar(select(Form).where(Form.public_token == token, Form.deleted_at.is_(None)))
    if not form or not form.is_active:
        raise HTTPException(status_code=404, detail="This form is not available")
    workspace = db.get(Workspace, form.workspace_id)
    if not workspace or workspace.deleted_at is not None:
        raise HTTPException(status_code=404, detail="This form is not available")
    org = db.get(Organization, workspace.organization_id)
    if not org or org.is_disabled or org.deleted_at is not None:
        raise HTTPException(status_code=404, detail="This form is not available")
    return form


@router.get("/public/forms/{token}", response_model=PublicFormOut)
@limiter.limit("60/minute")
def public_form(request: Request, token: str, db: Session = Depends(get_db)):
    form = _public_form(db, token)
    workspace = db.get(Workspace, form.workspace_id)
    return PublicFormOut(
        name=form.name,
        description=form.description,
        fields=form.fields,
        workspace_name=workspace.name if workspace else "",
    )


def _process_submission(
    db: Session, form: Form, raw_values: dict, submitter_email: str | None
) -> tuple[Task, str]:
    """Validate values, create the task + submission row. Returns (task, ref)."""
    project = db.get(Project, form.project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="This form is not available")

    # Validate values against the field definitions
    values: dict[str, str] = {}
    for field in form.fields:
        fid = field["id"]
        raw = raw_values.get(fid)
        value = str(raw).strip() if raw is not None else ""
        if field.get("required") and not value:
            raise HTTPException(status_code=422, detail=f"'{field['label']}' is required")
        if value:
            if len(value) > 5000:
                raise HTTPException(status_code=422, detail=f"'{field['label']}' is too long")
            if field["type"] == "email" and not EMAIL_RE.match(value):
                raise HTTPException(status_code=422, detail=f"'{field['label']}' must be a valid email")
            if field["type"] == "date":
                try:
                    date.fromisoformat(value)
                except ValueError:
                    raise HTTPException(status_code=422, detail=f"'{field['label']}' must be a date")
            if field["type"] == "select" and value not in [str(o) for o in field.get("options", [])]:
                raise HTTPException(status_code=422, detail=f"'{field['label']}' has an invalid option")
            values[fid] = value

    title_field = form.fields[0]
    title = values.get(title_field["id"], "").strip() or "Form submission"

    description_lines = [f"Submitted via form **{form.name}**.", ""]
    for field in form.fields[1:]:
        value = values.get(field["id"])
        if value:
            description_lines.append(f"{field['label']}: {value}")
    if submitter_email:
        if not EMAIL_RE.match(submitter_email.strip()):
            raise HTTPException(status_code=422, detail="Submitter email is invalid")
        description_lines.append(f"Submitted by: {submitter_email.strip()}")

    task = Task(
        project_id=project.id,
        number=task_service.claim_task_number(db, project.id),
        title=title[:500],
        description="\n".join(description_lines),
        status_id=task_service.default_status_id(db, project.id),
        task_type="task",
        labels=["form"],
        created_by=form.created_by,
    )
    db.add(task)
    db.flush()

    db.add(
        FormSubmission(
            form_id=form.id,
            task_id=task.id,
            data=values,
            submitter_email=(submitter_email or "").strip() or None,
        )
    )
    task_service.log_task_activity(
        db, project, task, "task.created", form.created_by, {"via_form": form.name}
    )
    task_service.emit_task_event("task.created", db, project, task, {"via_form": form.name})
    db.commit()
    return task, f"{project.key}-{task.number}"


@router.post("/public/forms/{token}", response_model=Message, status_code=201)
@limiter.limit("10/minute")
def submit_public_form(
    request: Request,
    token: str,
    body: PublicSubmission,
    db: Session = Depends(get_db),
):
    form = _public_form(db, token)
    _process_submission(db, form, body.values, body.submitter_email)
    return Message(detail="Thanks! Your submission has been received.")


@router.post("/forms/{form_id}/submit")
def submit_form_as_member(
    form_id: uuid.UUID,
    body: PublicSubmission,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """In-app submission by a workspace member (works even while the public link is paused)."""
    form = _get_form(db, perms, form_id)
    task, ref = _process_submission(db, form, body.values, perms.user.email)
    return {"detail": "Submission received", "task_id": str(task.id), "task_ref": ref}
