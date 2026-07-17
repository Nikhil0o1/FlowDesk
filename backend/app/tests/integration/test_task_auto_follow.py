"""Integration tests for task auto-follow inbox setting."""
import pytest

from app.services.task_follow_service import follower_user_ids
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


def _headers(client, user):
    return auth_headers(client, user.email)


@pytest.mark.integration
def test_auto_follow_on_create_and_comment_notify(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "follower@test.dev", role="member")
    db.commit()
    owner_headers = _headers(client, owner)
    member_headers = _headers(client, member)

    created = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=owner_headers,
        json={"title": "Follow me"},
    )
    assert created.status_code == 201
    task_id = created.json()["id"]
    assert owner.id in follower_user_ids(db, task_id)

    commented = client.post(
        f"/api/v1/tasks/{task_id}/comments",
        headers=member_headers,
        json={"body": "Hello followers"},
    )
    assert commented.status_code == 201
    assert member.id in follower_user_ids(db, task_id)

    # Thread replies live in Replies (view=replies), not Inbox Primary.
    replies = client.get("/api/v1/notifications?view=replies&unread_only=true", headers=owner_headers)
    assert replies.status_code == 200
    types = [item["type"] for item in replies.json()["items"]]
    assert "comment_reply" in types


@pytest.mark.integration
def test_auto_follow_disabled_skips_follow(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    db.commit()
    headers = _headers(client, owner)

    client.patch(
        "/api/v1/notifications/inbox-settings",
        headers=headers,
        json={"auto_follow_tasks": False},
    )

    created = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "No auto follow"},
    )
    assert created.status_code == 201
    task_id = created.json()["id"]
    assert follower_user_ids(db, task_id) == []


@pytest.mark.integration
def test_auto_follow_on_task_update(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "editor@test.dev", role="member")
    db.commit()
    owner_headers = _headers(client, owner)
    member_headers = _headers(client, member)

    created = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=owner_headers,
        json={"title": "Editable"},
    )
    task_id = created.json()["id"]

    client.patch(
        "/api/v1/notifications/inbox-settings",
        headers=member_headers,
        json={"auto_follow_tasks": True},
    )

    updated = client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=member_headers,
        json={"title": "Edited title"},
    )
    assert updated.status_code == 200
    assert member.id in follower_user_ids(db, task_id)
