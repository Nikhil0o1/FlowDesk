"""Security — attachment endpoints enforce per-task privacy ACL (VAPT #1)."""
import pytest

from app.models.task import Task, TaskAttachment, TaskShareMember
from app.services.storage_service import build_key, get_storage
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack

pytestmark = pytest.mark.security


def _private_task(db, project, owner) -> Task:
    task = add_task(db, project, owner, title="Private attachment task", number=88)
    task.is_private = True
    db.flush()
    return task


def _seed_attachment(db, task: Task, owner) -> TaskAttachment:
    content = b"%PDF-1.4\n% private attachment\n"
    key = build_key(task.id, "private.pdf")
    get_storage().save(key, content)
    attachment = TaskAttachment(
        task_id=task.id,
        uploaded_by=owner.id,
        file_name="private.pdf",
        storage_key=key,
        mime_type="application/pdf",
        size_bytes=len(content),
    )
    db.add(attachment)
    db.flush()
    return attachment


@pytest.mark.security
def test_private_task_attachment_download_idor_returns_404(client, db, org, owner):
    """Member with project access but no task ACL cannot download attachment bytes."""
    workspace, project = build_project_stack(db, org, owner)
    outsider = add_project_member(db, org, workspace, project, "idor-attach@test.dev")
    task = _private_task(db, project, owner)
    attachment = _seed_attachment(db, task, owner)

    headers = auth_headers(client, outsider.email)
    response = client.get(f"/api/v1/attachments/{attachment.id}/download", headers=headers)
    assert response.status_code == 404
    assert response.content != b"%PDF-1.4\n% private attachment\n"


@pytest.mark.security
def test_private_task_attachment_download_allowed_after_share(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    viewer = add_project_member(db, org, workspace, project, "idor-viewer@test.dev")
    task = _private_task(db, project, owner)
    attachment = _seed_attachment(db, task, owner)
    db.add(TaskShareMember(task_id=task.id, user_id=viewer.id, role="viewer", created_by=owner.id))
    db.flush()

    headers = auth_headers(client, viewer.email)
    response = client.get(f"/api/v1/attachments/{attachment.id}/download", headers=headers)
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")
