"""Coverage — sheet sync two-way create and inbound edge cases."""
from unittest.mock import patch

import pytest

from app.core.task_ref import format_task_ref
from app.models.integration import GoogleSheetSync
from app.models.task import CustomStatus
from app.services import sheet_sync_service as sheets
from app.tests.helpers import add_task, build_project_stack, seed_google_connection


@pytest.mark.coverage
def test_create_task_from_row(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="NEW")
    status = CustomStatus(project_id=project.id, name="Todo", color="#ccc", category="open", position=0)
    db.add(status)
    db.flush()
    conn = seed_google_connection(db, owner)
    sync = GoogleSheetSync(
        project_id=project.id,
        connection_id=conn.id,
        spreadsheet_id="sheet-new",
        spreadsheet_url="https://sheets/new",
        sync_mode="two_way",
        created_by=owner.id,
        snapshot={},
    )
    db.add(sync)
    db.flush()

    cells = {
        "Ref": "NEW-99",
        "Title": "From sheet",
        "Status": "Todo",
        "Type": "task",
        "Priority": "high",
        "Story points": "3",
        "Labels": "alpha",
        "Due date": "",
        "Assignees": owner.email,
    }
    task = sheets._create_task_from_row(
        db, sync, project, cells, {status.name.lower(): status}, {owner.email.lower(): owner.id}
    )
    assert task.title == "From sheet"
    assert task.priority == "high"


@pytest.mark.coverage
@patch("app.services.sheet_sync_service.google_service.sheets_read")
@patch("app.services.sheet_sync_service.google_service.sheets_overwrite")
def test_run_sync_two_way(mock_overwrite, mock_read, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="TWO")
    task = add_task(db, project, owner, title="Original", number=1)
    ref = format_task_ref(project.id, 1)
    conn = seed_google_connection(db, owner)
    sync = GoogleSheetSync(
        project_id=project.id,
        connection_id=conn.id,
        spreadsheet_id="sheet-two-run",
        spreadsheet_url="https://sheets/two-run",
        sync_mode="two_way",
        created_by=owner.id,
        snapshot={ref: [ref, "Original", "", "task", "normal", "", "", "", "", "", ""]},
    )
    db.add(sync)
    db.flush()
    mock_read.return_value = [
        sheets.HEADER,
        [ref, "Sheet edit", "", "task", "normal", "", "", "", "", "", ""],
    ]

    assert sheets.run_sync(db, sync) is True
    mock_read.assert_called_once()
    mock_overwrite.assert_called_once()
    assert task.title == "Sheet edit"


@pytest.mark.coverage
def test_apply_sheet_edits_skips_modified_header(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    conn = seed_google_connection(db, owner)
    sync = GoogleSheetSync(
        project_id=project.id,
        connection_id=conn.id,
        spreadsheet_id="bad-header",
        spreadsheet_url="https://sheets/bad",
        sync_mode="two_way",
        created_by=owner.id,
        snapshot={},
    )
    db.add(sync)
    db.flush()

    updated, created = sheets.apply_sheet_edits(db, sync, project, [["Wrong", "Header"]])
    assert updated == 0 and created == 0
