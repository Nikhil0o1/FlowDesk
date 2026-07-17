"""Attachment upload, download, delete — API integration with permission enforcement."""
from io import BytesIO

import pytest

from app.models.task import Task, TaskAttachment
from app.models.task import TaskShareMember
from app.services.storage_service import build_key, get_storage
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack

pytestmark = pytest.mark.integration


def _pdf_bytes() -> bytes:
    return b"%PDF-1.4\n% test attachment content\n"


def _private_task(db, project, owner, *, title: str = "Private") -> Task:
    task = add_task(db, project, owner, title=title, number=99)
    task.is_private = True
    db.flush()
    return task


def _seed_attachment(db, task: Task, owner, content: bytes | None = None) -> TaskAttachment:
    """Persist attachment row + bytes in storage (bypasses multipart upload for ACL tests)."""
    payload = content if content is not None else _pdf_bytes()
    key = build_key(task.id, "secret.pdf")
    get_storage().save(key, payload)
    attachment = TaskAttachment(
        task_id=task.id,
        uploaded_by=owner.id,
        file_name="secret.pdf",
        storage_key=key,
        mime_type="application/pdf",
        size_bytes=len(payload),
    )
    db.add(attachment)
    db.flush()
    return attachment


def test_upload_and_download_attachment(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    upload = client.post(
        f"/api/v1/tasks/{task.id}/attachments",
        headers=headers,
        files={"file": ("notes.pdf", BytesIO(_pdf_bytes()), "application/pdf")},
    )
    assert upload.status_code == 201, upload.text
    attachment_id = upload.json()["id"]
    assert upload.json()["file_name"] == "notes.pdf"

    download = client.get(f"/api/v1/attachments/{attachment_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.content.startswith(b"%PDF")
    assert download.headers.get("X-Content-Type-Options") == "nosniff"


def test_outsider_cannot_download_attachment(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    owner_headers = auth_headers(client, owner.email)

    upload = client.post(
        f"/api/v1/tasks/{task.id}/attachments",
        headers=owner_headers,
        files={"file": ("secret.pdf", BytesIO(_pdf_bytes()), "application/pdf")},
    )
    attachment_id = upload.json()["id"]

    from app.models.workspace import WorkspaceMember
    from app.tests.conftest import make_user

    stranger = make_user(db, "attach-stranger@test.dev")
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=stranger.id, role="member"))
    db.flush()
    stranger_headers = auth_headers(client, stranger.email)
    assert client.get(f"/api/v1/attachments/{attachment_id}/download", headers=stranger_headers).status_code == 404


def test_upload_rejects_executable_at_api_layer(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    upload = client.post(
        f"/api/v1/tasks/{task.id}/attachments",
        headers=headers,
        files={"file": ("evil.exe", BytesIO(b"MZ\x90\x00" + b"\x00" * 64), "application/octet-stream")},
    )
    assert upload.status_code == 400


def test_uploader_can_delete_own_attachment(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    upload = client.post(
        f"/api/v1/tasks/{task.id}/attachments",
        headers=headers,
        files={"file": ("temp.pdf", BytesIO(_pdf_bytes()), "application/pdf")},
    )
    attachment_id = upload.json()["id"]

    delete = client.delete(f"/api/v1/attachments/{attachment_id}", headers=headers)
    assert delete.status_code == 200
    attachment = db.get(TaskAttachment, attachment_id)
    assert attachment.deleted_at is not None


def test_member_cannot_delete_others_attachment_without_admin(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "attach-member@test.dev", role="member")
    task = add_task(db, project, owner)

    owner_headers = auth_headers(client, owner.email)
    upload = client.post(
        f"/api/v1/tasks/{task.id}/attachments",
        headers=owner_headers,
        files={"file": ("owner.pdf", BytesIO(_pdf_bytes()), "application/pdf")},
    )
    attachment_id = upload.json()["id"]

    member_headers = auth_headers(client, member.email)
    delete = client.delete(f"/api/v1/attachments/{attachment_id}", headers=member_headers)
    assert delete.status_code == 403


def test_get_attachment_url_requires_view_permission(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    upload = client.post(
        f"/api/v1/tasks/{task.id}/attachments",
        headers=headers,
        files={"file": ("link.pdf", BytesIO(_pdf_bytes()), "application/pdf")},
    )
    attachment_id = upload.json()["id"]

    url_resp = client.get(f"/api/v1/attachments/{attachment_id}/url", headers=headers)
    assert url_resp.status_code == 200
    assert "url" in url_resp.json()


def test_private_task_attachment_download_blocked_for_unshared_project_member(client, db, org, owner):
    """VAPT #1 — project member B must not download private-task attachments (BOLA)."""
    workspace, project = build_project_stack(db, org, owner)
    member_b = add_project_member(db, org, workspace, project, "attach-member-b@test.dev")
    task = _private_task(db, project, owner)
    attachment = _seed_attachment(db, task, owner)

    member_headers = auth_headers(client, member_b.email)
    assert (
        client.get(f"/api/v1/attachments/{attachment.id}/download", headers=member_headers).status_code
        == 404
    )
    assert client.get(f"/api/v1/attachments/{attachment.id}/url", headers=member_headers).status_code == 404


def test_private_task_attachment_upload_and_delete_blocked_for_unshared_project_member(
    client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner)
    member_b = add_project_member(db, org, workspace, project, "attach-member-b@test.dev")
    task = _private_task(db, project, owner)
    attachment = _seed_attachment(db, task, owner)
    member_headers = auth_headers(client, member_b.email)

    upload = client.post(
        f"/api/v1/tasks/{task.id}/attachments",
        headers=member_headers,
        files={"file": ("evil.pdf", BytesIO(_pdf_bytes()), "application/pdf")},
    )
    assert upload.status_code == 403

    delete = client.delete(f"/api/v1/attachments/{attachment.id}", headers=member_headers)
    assert delete.status_code == 403


def test_private_task_shared_viewer_can_download_attachment(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    viewer = add_project_member(db, org, workspace, project, "attach-viewer@test.dev")
    task = _private_task(db, project, owner)
    db.add(TaskShareMember(task_id=task.id, user_id=viewer.id, role="viewer", created_by=owner.id))
    attachment = _seed_attachment(db, task, owner)
    db.flush()

    viewer_headers = auth_headers(client, viewer.email)
    download = client.get(f"/api/v1/attachments/{attachment.id}/download", headers=viewer_headers)
    assert download.status_code == 200
    assert download.content.startswith(b"%PDF")
