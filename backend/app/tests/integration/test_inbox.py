"""Phase 3 integration — inbox tabs, clear, snooze, preferences."""
import pytest
from datetime import datetime, timedelta, timezone

from app.models.notification import Notification
from app.services.notification_service import notify
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, build_project_stack


def _headers(client, user):
    return auth_headers(client, user.email)


@pytest.mark.integration
def test_inbox_excludes_comment_replies_from_primary(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    notify(db, owner.id, "task_assigned", "Assigned", "body", workspace_id=workspace.id, project_id=project.id)
    notify(db, owner.id, "comment_reply", "New reply", "body", workspace_id=workspace.id, project_id=project.id)
    db.commit()
    headers = _headers(client, owner)

    primary = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=headers)
    assert primary.status_code == 200
    assert primary.json()["total"] == 1
    assert primary.json()["items"][0]["type"] == "task_assigned"

    replies = client.get("/api/v1/notifications?view=replies&unread_only=true", headers=headers)
    assert replies.status_code == 200
    assert replies.json()["total"] == 1
    assert replies.json()["items"][0]["type"] == "comment_reply"


@pytest.mark.integration
def test_inbox_primary_vs_other_tabs(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    notify(db, owner.id, "task_assigned", "Assigned", "body", workspace_id=workspace.id, project_id=project.id)
    notify(db, owner.id, "github_pr_opened", "PR opened", "body", workspace_id=workspace.id, project_id=project.id)
    db.commit()
    headers = _headers(client, owner)

    primary = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=headers)
    assert primary.status_code == 200
    assert primary.json()["total"] == 1
    assert primary.json()["items"][0]["type"] == "task_assigned"

    other = client.get("/api/v1/notifications?tab=other&view=inbox", headers=headers)
    assert other.status_code == 200
    assert other.json()["total"] == 1
    assert other.json()["items"][0]["type"] == "github_pr_opened"


@pytest.mark.integration
def test_inbox_snooze_and_later_tab(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    n = notify(db, owner.id, "task_assigned", "Assigned", "body", workspace_id=workspace.id, project_id=project.id)
    db.commit()
    headers = _headers(client, owner)

    until = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    snooze = client.post(f"/api/v1/notifications/{n.id}/snooze", headers=headers, json={"until": until})
    assert snooze.status_code == 200

    primary = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=headers)
    assert primary.json()["total"] == 0

    later = client.get("/api/v1/notifications?tab=later", headers=headers)
    assert later.json()["total"] == 1


@pytest.mark.integration
def test_inbox_clear_tab(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    notify(db, owner.id, "task_assigned", "Assigned", "body", workspace_id=workspace.id, project_id=project.id)
    db.commit()
    headers = _headers(client, owner)

    cleared = client.post("/api/v1/notifications/clear-tab?tab=primary", headers=headers)
    assert cleared.status_code == 200

    primary = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=headers)
    assert primary.json()["total"] == 0

    archive = client.get("/api/v1/notifications?tab=cleared", headers=headers)
    assert archive.json()["total"] == 1
    assert archive.json()["items"][0]["cleared_at"] is not None


@pytest.mark.integration
def test_inbox_preferences_and_summary(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    notify(db, owner.id, "comment_mention", "Mention", "body", data={"task_id": "x"}, workspace_id=workspace.id, project_id=project.id)
    notify(db, owner.id, "task_assigned", "Assigned", "body", workspace_id=workspace.id, project_id=project.id)
    notify(db, owner.id, "github_pr_opened", "PR", "body", workspace_id=workspace.id, project_id=project.id)
    db.commit()
    headers = _headers(client, owner)

    prefs = client.get("/api/v1/notifications/preferences", headers=headers)
    assert prefs.status_code == 200
    assert prefs.json()["total_count"] == 31
    types = {item["type"] for item in prefs.json()["items"]}
    labels = [item["label"] for item in prefs.json()["items"]]
    assert len(labels) == len(set(labels)), "Each notification type must have a unique label"
    assert "comment_mention" in types
    assert "github_pr_opened" in types

    patch = client.patch(
        "/api/v1/notifications/preferences",
        headers=headers,
        json={"type": "github_pr_opened", "important": True},
    )
    assert patch.status_code == 200

    primary = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=headers)
    primary_types = {item["type"] for item in primary.json()["items"]}
    assert "github_pr_opened" in primary_types

    summary = client.get("/api/v1/notifications/summary?tab=primary", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["mentions"] >= 1
    assert summary.json()["assigned_to_me"] >= 1


@pytest.mark.integration
def test_inbox_mark_unread_and_restore(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    n = notify(db, owner.id, "task_assigned", "Assigned", "body", workspace_id=workspace.id, project_id=project.id)
    db.commit()
    headers = _headers(client, owner)

    read = client.post(f"/api/v1/notifications/{n.id}/read", headers=headers)
    assert read.status_code == 200

    unread = client.post(f"/api/v1/notifications/{n.id}/unread", headers=headers)
    assert unread.status_code == 200

    cleared = client.post(f"/api/v1/notifications/{n.id}/clear", headers=headers)
    assert cleared.status_code == 200

    restored = client.post(f"/api/v1/notifications/{n.id}/unclear", headers=headers)
    assert restored.status_code == 200
    assert restored.json()["cleared_at"] is None

    snooze = client.post(
        f"/api/v1/notifications/{n.id}/snooze",
        headers=headers,
        json={"until": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()},
    )
    assert snooze.status_code == 200

    unsnooze = client.post(f"/api/v1/notifications/{n.id}/unsnooze", headers=headers)
    assert unsnooze.status_code == 200
    assert unsnooze.json()["snoozed_until"] is None


@pytest.mark.integration
def test_inbox_replies_view(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "replier@test.dev", role="member")
    db.commit()
    owner_headers = _headers(client, owner)
    member_headers = _headers(client, member)

    created = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=owner_headers,
        json={"title": "Discuss"},
    )
    task_id = created.json()["id"]

    parent = client.post(
        f"/api/v1/tasks/{task_id}/comments",
        headers=owner_headers,
        json={"body": "Parent comment"},
    )
    parent_id = parent.json()["id"]

    reply = client.post(
        f"/api/v1/tasks/{task_id}/comments",
        headers=member_headers,
        json={"body": "A reply", "parent_comment_id": parent_id},
    )
    assert reply.status_code == 201

    unread = client.get("/api/v1/notifications?view=replies&unread_only=true", headers=owner_headers)
    assert unread.status_code == 200
    assert unread.json()["total"] >= 1
    assert unread.json()["items"][0]["type"] == "comment_reply"

    count = client.get("/api/v1/notifications/replies-unread-count", headers=owner_headers)
    assert count.status_code == 200
    assert count.json()["count"] >= 1

    read = client.get("/api/v1/notifications?view=replies&read_only=true", headers=owner_headers)
    assert read.status_code == 200
    assert all(item["read_at"] is not None for item in read.json()["items"]) or read.json()["total"] == 0


@pytest.mark.integration
def test_inbox_settings(client, db, org, owner):
    headers = _headers(client, owner)
    settings = client.get("/api/v1/notifications/inbox-settings", headers=headers)
    assert settings.status_code == 200
    assert settings.json()["display_mode"] == "fullscreen"

    patched = client.patch(
        "/api/v1/notifications/inbox-settings",
        headers=headers,
        json={"show_all_tab": True, "display_mode": "inline"},
    )
    assert patched.status_code == 200
    assert patched.json()["show_all_tab"] is True
    assert patched.json()["display_mode"] == "inline"
