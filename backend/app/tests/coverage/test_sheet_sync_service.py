"""Phase 6 — Google Sheet sync helpers and report builders."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.core.task_ref import format_task_ref
from app.models.integration import GoogleSheetSync
from app.models.task import CustomStatus
from app.models.time_entry import TimeEntry
from app.services import sheet_sync_service as sheets
from app.tests.helpers import add_task, build_project_stack, seed_google_connection


@pytest.mark.coverage
def test_build_project_rows_includes_task_ref(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SH1")
    add_task(db, project, owner, title="Sheet row task", number=3)
    db.flush()

    rows = sheets.build_project_rows(db, project)
    assert rows[0] == sheets.HEADER
    ref = format_task_ref(project.id, 3)
    assert any(row[0] == ref and row[1] == "Sheet row task" for row in rows[1:])


@pytest.mark.coverage
def test_apply_cell_updates_title_and_labels(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Before", number=1)
    status = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(status)
    db.flush()
    status_map = {status.name.lower(): status}

    assert sheets._apply_cell(db, task, "Title", "After", status_map) is True
    assert task.title == "After"

    assert sheets._apply_cell(db, task, "Labels", "bug, urgent", status_map) is True
    assert task.labels == ["bug", "urgent"]


@pytest.mark.coverage
def test_build_time_report_aggregates_entries(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="TM1")
    task = add_task(db, project, owner, title="Timed", number=1)
    started = datetime.now(timezone.utc) - timedelta(hours=2)
    ended = started + timedelta(hours=1)
    db.add(
        TimeEntry(
            task_id=task.id,
            user_id=owner.id,
            started_at=started,
            ended_at=ended,
            duration_seconds=3600,
            is_manual=True,
            description="Focused work",
        )
    )
    db.flush()

    entries_tab, summary_tab = sheets.build_time_report(db, project)
    assert entries_tab[0] == sheets.TIME_HEADER
    assert len(entries_tab) >= 2
    assert summary_tab[0][0] == "Time report"
    assert any(row[0] == "Total hours" for row in summary_tab)


@pytest.mark.coverage
@patch("app.services.sheet_sync_service.google_service.sheets_overwrite")
@patch("app.services.sheet_sync_service.google_service.sheets_read")
def test_run_sync_export_mode(mock_read, mock_overwrite, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SYN")
    add_task(db, project, owner, title="Sync task", number=1)
    conn = seed_google_connection(db, owner)
    sync = GoogleSheetSync(
        project_id=project.id,
        connection_id=conn.id,
        spreadsheet_id="sheet-sync-1",
        spreadsheet_url="https://sheets/sync-1",
        sync_mode="export",
        created_by=owner.id,
    )
    db.add(sync)
    db.flush()

    assert sheets.run_sync(db, sync) is True
    mock_read.assert_not_called()
    mock_overwrite.assert_called_once()
    assert sync.last_synced_at is not None


@pytest.mark.coverage
def test_apply_sheet_edits_updates_title_from_snapshot_diff(db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="TWO")
    task = add_task(db, project, owner, title="Original", number=1)
    conn = seed_google_connection(db, owner)
    ref = format_task_ref(project.id, 1)
    sync = GoogleSheetSync(
        project_id=project.id,
        connection_id=conn.id,
        spreadsheet_id="sheet-two-way",
        spreadsheet_url="https://sheets/two",
        sync_mode="two_way",
        created_by=owner.id,
        snapshot={ref: [ref, "Original", "", "task", "normal", "", "", "", "", "", ""]},
    )
    db.add(sync)
    db.flush()

    sheet_rows = [
        sheets.HEADER,
        [ref, "Edited in sheet", "", "task", "normal", "", "", "", "", "", ""],
    ]
    updated, created = sheets.apply_sheet_edits(db, sync, project, sheet_rows)
    assert updated == 1
    assert created == 0
    assert task.title == "Edited in sheet"
