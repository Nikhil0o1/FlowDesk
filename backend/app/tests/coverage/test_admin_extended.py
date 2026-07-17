"""Coverage — platform admin metadata, audit logs, and cron logs."""
from datetime import datetime, timezone

import pytest

from app.models.audit import AuditLog, CronJobLog
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack


@pytest.mark.coverage
def test_admin_org_metadata_and_search(client, db, org, owner, superadmin):
    build_project_stack(db, org, owner)
    headers = auth_headers(client, "super@test.dev")

    detail = client.get(f"/api/v1/admin/organizations/{org.id}", headers=headers)
    assert detail.status_code == 200
    meta = detail.json()
    assert meta["member_count"] >= 1
    assert meta["workspace_count"] >= 1
    assert meta["project_count"] >= 1

    search = client.get("/api/v1/admin/organizations", headers=headers, params={"q": "Test Org"})
    assert search.status_code == 200
    assert search.json()["total"] >= 1


@pytest.mark.coverage
def test_admin_audit_logs_filter(client, db, org, owner, superadmin):
    db.add(
        AuditLog(
            organization_id=org.id,
            actor_id=owner.id,
            action="organization.created",
            target_type="organization",
            target_id=str(org.id),
        )
    )
    db.flush()
    headers = auth_headers(client, "super@test.dev")

    logs = client.get("/api/v1/admin/audit-logs", headers=headers, params={"action": "organization.created"})
    assert logs.status_code == 200
    assert logs.json()["total"] >= 1
    assert logs.json()["items"][0]["action"] == "organization.created"


@pytest.mark.coverage
def test_admin_cron_logs(client, db, superadmin):
    db.add(
        CronJobLog(
            job_name="sheet_sync",
            started_at=datetime.now(timezone.utc),
            finished_at=datetime.now(timezone.utc),
            status="success",
            items_processed=3,
            message="ok",
        )
    )
    db.flush()
    headers = auth_headers(client, "super@test.dev")

    logs = client.get("/api/v1/admin/cron-logs", headers=headers, params={"job_name": "sheet_sync"})
    assert logs.status_code == 200
    assert logs.json()["total"] >= 1
    assert logs.json()["items"][0]["job_name"] == "sheet_sync"
