"""Phase 3 integration — notifications API."""
import pytest

from app.models.notification import Notification
from app.services.notification_service import notify
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack


@pytest.mark.integration
def test_list_and_mark_notifications_read(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    notify(
        db,
        owner.id,
        "test_event",
        "Test title",
        "Test body",
        workspace_id=workspace.id,
        project_id=project.id,
    )
    db.flush()
    headers = auth_headers(client, owner.email)

    listed = client.get("/api/v1/notifications", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1
    notif_id = listed.json()["items"][0]["id"]

    mark = client.post(f"/api/v1/notifications/{notif_id}/read", headers=headers)
    assert mark.status_code == 200
    notif = db.get(Notification, notif_id)
    assert notif.read_at is not None


@pytest.mark.integration
def test_mark_all_notifications_read(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    notify(db, owner.id, "a", "A", "body", workspace_id=workspace.id, project_id=project.id)
    notify(db, owner.id, "b", "B", "body", workspace_id=workspace.id, project_id=project.id)
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post("/api/v1/notifications/read-all", headers=headers)
    assert response.status_code == 200

    listed = client.get("/api/v1/notifications?unread_only=true", headers=headers)
    assert listed.json()["total"] == 0


@pytest.mark.integration
def test_notifications_require_auth(client):
    assert client.get("/api/v1/notifications").status_code == 401
