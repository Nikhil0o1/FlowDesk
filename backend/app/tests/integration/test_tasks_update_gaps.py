"""Integration — task update clear-fields, list_id, recurring, filters, and attachments."""
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from unittest.mock import patch

import pytest

from app.core.task_ref import format_task_ref
from app.models.project import TaskList
from app.services.github_issue_body import format_github_issue_body
from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


def _pdf_bytes() -> bytes:
    return b"%PDF-1.4\n% task attachment\n"


@pytest.mark.integration
def test_update_task_clear_fields(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="CLR")
    task = add_task(db, project, owner, title="Clear me", number=1)
    task.priority = "high"
    task.start_date = date.today()
    task.due_date = date.today() + timedelta(days=3)
    task.planned_start_at = datetime.now(timezone.utc)
    task.planned_end_at = datetime.now(timezone.utc) + timedelta(hours=2)
    task.time_estimate_seconds = 90 * 60
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={
            "clear_priority": True,
            "clear_start_date": True,
            "clear_due_date": True,
            "clear_planned_times": True,
            "clear_time_estimate": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["priority"] is None
    assert body["start_date"] is None
    assert body["due_date"] is None
    assert body["planned_start_at"] is None
    assert body["planned_end_at"] is None
    assert body["time_estimate_seconds"] is None


@pytest.mark.integration
def test_update_task_with_list_id_and_filter(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="LST")
    headers = auth_headers(client, owner.email)
    task_list = client.post(
        f"/api/v1/projects/{project.id}/lists",
        headers=headers,
        json={"name": "Inbox"},
    ).json()
    in_list = add_task(db, project, owner, title="In list", number=1)
    in_list.list_id = task_list["id"]
    other = add_task(db, project, owner, title="No list", number=2)
    db.flush()

    patched = client.patch(
        f"/api/v1/tasks/{other.id}",
        headers=headers,
        json={"list_id": task_list["id"]},
    )
    assert patched.status_code == 200
    assert patched.json()["list_id"] == task_list["id"]

    filtered = client.get(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        params={"list_id": task_list["id"]},
    )
    assert filtered.status_code == 200
    titles = {t["title"] for t in filtered.json()["items"]}
    assert titles == {"In list", "No list"}


@pytest.mark.integration
def test_list_tasks_due_today_and_week_filters(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="DUE")
    today = date.today()
    today_task = add_task(db, project, owner, title="Due today", number=1)
    today_task.due_date = today
    week_task = add_task(db, project, owner, title="Due this week", number=2)
    week_task.due_date = today + timedelta(days=5)
    add_task(db, project, owner, title="No due", number=3)
    db.flush()
    headers = auth_headers(client, owner.email)

    today_only = client.get(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        params={"due": "today"},
    )
    assert all(t["title"] == "Due today" for t in today_only.json()["items"])

    week_only = client.get(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        params={"due": "week"},
    )
    week_titles = {t["title"] for t in week_only.json()["items"]}
    assert week_titles == {"Due today", "Due this week"}


@pytest.mark.integration
def test_recurring_task_with_list_id(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="REC")
    headers = auth_headers(client, owner.email)
    task_list = client.post(
        f"/api/v1/projects/{project.id}/lists",
        headers=headers,
        json={"name": "Recurring bucket"},
    ).json()
    next_at = datetime.now(timezone.utc) + timedelta(days=2)

    created = client.post(
        f"/api/v1/projects/{project.id}/recurring-tasks",
        headers=headers,
        json={
            "frequency": "monthly",
            "interval": 1,
            "list_id": task_list["id"],
            "template": {"title": "Monthly review"},
            "next_occurrence_at": next_at.isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    rec_id = created.json()["id"]

    listed = client.get(f"/api/v1/projects/{project.id}/recurring-tasks", headers=headers)
    assert listed.status_code == 200
    rec = next(r for r in listed.json() if r["id"] == rec_id)
    assert rec["template"]["title"] == "Monthly review"


@pytest.mark.integration
def test_get_task_detail_includes_attachments(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ATT")
    task = add_task(db, project, owner, title="With files", number=1)
    headers = auth_headers(client, owner.email)

    upload = client.post(
        f"/api/v1/tasks/{task.id}/attachments",
        headers=headers,
        files={"file": ("spec.pdf", BytesIO(_pdf_bytes()), "application/pdf")},
    )
    assert upload.status_code == 201

    detail = client.get(f"/api/v1/tasks/{task.id}", headers=headers)
    assert detail.status_code == 200
    attachments = detail.json()["attachments"]
    assert len(attachments) == 1
    assert attachments[0]["file_name"] == "spec.pdf"
    assert attachments[0]["uploader"]["email"] == owner.email


@pytest.mark.integration
def test_update_task_clear_parent_and_duplicate(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="PAR")
    headers = auth_headers(client, owner.email)
    parent = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Parent", "priority": "normal", "task_type": "task"},
    ).json()
    sub = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={
            "title": "Child",
            "priority": "normal",
            "task_type": "task",
            "parent_task_id": parent["id"],
        },
    ).json()

    cleared = client.patch(
        f"/api/v1/tasks/{sub['id']}",
        headers=headers,
        json={"clear_parent": True},
    )
    assert cleared.status_code == 200
    assert cleared.json()["parent_task_id"] is None

    dup = client.post(f"/api/v1/tasks/{parent['id']}/duplicate", headers=headers)
    assert dup.status_code == 201
    assert "(copy)" in dup.json()["title"]


@pytest.mark.integration
def test_delete_task_and_custom_field_crud(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="DEL")
    task = add_task(db, project, owner, title="Disposable", number=9)
    headers = auth_headers(client, owner.email)

    field = client.post(
        f"/api/v1/projects/{project.id}/custom-fields",
        headers=headers,
        json={"name": "Severity", "field_type": "text"},
    ).json()
    client.put(
        f"/api/v1/tasks/{task.id}/custom-fields/{field['id']}",
        headers=headers,
        json={"value": {"text": "high"}},
    )
    client.patch(f"/api/v1/custom-fields/{field['id']}", headers=headers, json={"name": "Impact"})
    client.delete(f"/api/v1/custom-fields/{field['id']}", headers=headers)

    deleted = client.delete(f"/api/v1/tasks/{task.id}", headers=headers)
    assert deleted.status_code == 200


@pytest.mark.integration
@patch("app.api.v1.tasks.github_api_service.patch_issue")
def test_update_task_description_syncs_github_issue(mock_patch, client, db, org, owner):
    from app.tests.helpers import seed_github_repo, seed_project_github

    workspace, project = build_project_stack(db, org, owner, project_key="DSC")
    conn = seed_project_github(db, org, project, owner)
    seed_github_repo(db, workspace, project, conn)
    task = add_task(db, project, owner, title="Sync desc", number=1)
    task.github_issue_number = 10
    task.description = "old"
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"description": "New description from FlowDesk"},
    )
    assert response.status_code == 200
    mock_patch.assert_called_once()
    task_ref = format_task_ref(project.id, task.number)
    expected_body = format_github_issue_body(
        task_ref=task_ref,
        title=task.title,
        description="New description from FlowDesk",
        task_id=task.id,
    )
    assert mock_patch.call_args.kwargs["body"] == expected_body
