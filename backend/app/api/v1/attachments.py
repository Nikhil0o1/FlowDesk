import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.rate_limit import limiter, upload_rate_key
from app.db.session import get_db
from app.models.task import Task, TaskAttachment
from app.schemas.common import Message
from app.schemas.task import AttachmentOut
from app.services import task_service
from app.services.permission_service import PermissionService
from app.services.storage_service import build_key, get_storage, safe_download_media_type, validate_upload
from app.services.upload_service import guard_upload_request, max_attachment_bytes, read_bounded_upload
from app.services.user_service import user_brief

router = APIRouter(tags=["attachments"])


def _load_task_or_404(
    db: Session,
    perms: PermissionService,
    task_id: uuid.UUID,
    *,
    require_edit: bool,
) -> Task:
    """Resolve a task and enforce per-task ACL (private tasks are not project-wide)."""
    task = db.get(Task, task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Task not found")
    if require_edit:
        perms.require_task_edit(task)
    else:
        perms.require_task_view(task)
    return task


def _load_attachment_or_404(
    db: Session,
    perms: PermissionService,
    attachment_id: uuid.UUID,
    *,
    require_edit: bool,
) -> tuple[TaskAttachment, Task]:
    """Load attachment + parent task; enforce per-task view/edit ACL before serving bytes."""
    attachment = db.get(TaskAttachment, attachment_id)
    if not attachment or attachment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    task = db.get(Task, attachment.task_id)
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if require_edit:
        perms.require_task_edit(task)
    else:
        perms.require_task_view(task)
    return attachment, task


@router.post("/tasks/{task_id}/attachments", response_model=AttachmentOut, status_code=201)
@limiter.limit("30/minute", key_func=upload_rate_key)
async def upload_attachment(
    request: Request,
    task_id: uuid.UUID,
    file: UploadFile,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    guard_upload_request(request, max_attachment_bytes())
    task = _load_task_or_404(db, perms, task_id, require_edit=True)
    project = perms.get_project_or_404(task.project_id)

    content = await read_bounded_upload(file, max_attachment_bytes())
    validate_upload(file, content)
    key = build_key(task_id, file.filename or "file")
    get_storage().save(key, content)

    attachment = TaskAttachment(
        task_id=task_id,
        uploaded_by=perms.user.id,
        file_name=(file.filename or "file")[:300],
        storage_key=key,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
    )
    db.add(attachment)
    db.flush()
    task_service.log_task_activity(
        db, project, task, "attachment.added", perms.user.id, {"file_name": attachment.file_name}
    )
    task_service.emit_task_event("task.updated", db, project, task, {"fields": ["attachments"]})
    db.commit()
    out = AttachmentOut.model_validate(attachment)
    out.uploader = user_brief(db, perms.user.id)
    return out


@router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    attachment, task = _load_attachment_or_404(db, perms, attachment_id, require_edit=False)
    content = get_storage().read(attachment.storage_key)
    safe_name = attachment.file_name.replace('"', "")
    media_type = safe_download_media_type(attachment.file_name, attachment.mime_type, content)
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/attachments/{attachment_id}/url")
def get_attachment_url(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    attachment, task = _load_attachment_or_404(db, perms, attachment_id, require_edit=False)
    url = get_storage().presigned_url(attachment.storage_key)
    return {"url": url, "presigned": url is not None}


@router.delete("/attachments/{attachment_id}", response_model=Message)
def delete_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    attachment, task = _load_attachment_or_404(db, perms, attachment_id, require_edit=True)
    project = perms.get_project_or_404(task.project_id)
    if attachment.uploaded_by != perms.user.id:
        perms.require_project_admin(task.project_id)
    attachment.deleted_at = datetime.now(timezone.utc)
    get_storage().delete(attachment.storage_key)
    task_service.log_task_activity(
        db, project, task, "attachment.removed", perms.user.id, {"file_name": attachment.file_name}
    )
    db.commit()
    return Message(detail="Attachment deleted")
