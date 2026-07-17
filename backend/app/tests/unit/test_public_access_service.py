"""Phase 2 unit tests — public task link resolution (VAPT #13)."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.services.public_access_service import public_assignee_display, resolve_public_task
from app.tests.helpers import add_task, build_project_stack


@pytest.mark.unit
def test_resolve_public_task_happy_path(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, number=60)
    task.public_enabled = True
    task.public_token = "valid-token"
    db.flush()

    resolved_task, resolved_project = resolve_public_task(db, "valid-token")
    assert resolved_task.id == task.id
    assert resolved_project.id == project.id


@pytest.mark.unit
def test_resolve_public_task_expired(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, number=61)
    task.public_enabled = True
    task.public_token = "expired"
    task.public_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        resolve_public_task(db, "expired")
    assert exc.value.status_code == 404


@pytest.mark.unit
def test_resolve_public_task_archived_project(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, number=62)
    task.public_enabled = True
    task.public_token = "archived-proj"
    project.is_archived = True
    db.flush()

    with pytest.raises(HTTPException) as exc:
        resolve_public_task(db, "archived-proj")
    assert exc.value.status_code == 404


@pytest.mark.unit
def test_resolve_public_task_deleted_workspace(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, number=63)
    task.public_enabled = True
    task.public_token = "deleted-ws"
    workspace.deleted_at = datetime.now(timezone.utc)
    db.flush()

    with pytest.raises(HTTPException) as exc:
        resolve_public_task(db, "deleted-ws")
    assert exc.value.status_code == 404


@pytest.mark.unit
def test_public_assignee_display_no_email_leak():
    uid = uuid.uuid4()
    info = public_assignee_display("Jane Doe", uid)
    assert info["display_name"] == "Jane Doe"
    assert "email" not in info


@pytest.mark.unit
def test_public_assignee_display_fallback_name():
    uid = uuid.uuid4()
    info = public_assignee_display(None, uid)
    assert info["display_name"] == "Team member"
