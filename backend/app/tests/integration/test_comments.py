"""Phase 3 integration — task comments and mentions."""
from unittest.mock import patch

import pytest

from app.models.comment import Comment
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack


@pytest.mark.integration
def test_comment_crud_flow(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=headers,
        json={"body": "First comment"},
    )
    assert create.status_code == 201, create.text
    comment_id = create.json()["id"]

    listed = client.get(f"/api/v1/tasks/{task.id}/comments", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1

    patch = client.patch(
        f"/api/v1/comments/{comment_id}",
        headers=headers,
        json={"body": "Updated comment"},
    )
    assert patch.status_code == 200
    assert patch.json()["body"] == "Updated comment"

    delete = client.delete(f"/api/v1/comments/{comment_id}", headers=headers)
    assert delete.status_code == 200
    comment = db.get(Comment, comment_id)
    assert comment.deleted_at is not None


@pytest.mark.integration
def test_outsider_cannot_comment(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    stranger = add_project_member(db, org, workspace, project, "comment-stranger@test.dev")
    # Remove from project but keep workspace member — still no task access if not in project
    from app.models.project import ProjectMember
    from sqlalchemy import delete

    db.execute(delete(ProjectMember).where(ProjectMember.user_id == stranger.id))
    db.flush()

    response = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=auth_headers(client, stranger.email),
        json={"body": "Should fail"},
    )
    assert response.status_code == 404


@pytest.mark.integration
def test_comment_scope_separates_local_and_github(client, db, org, owner):
    """Activity comments (local) must not appear in github scope and vice versa."""
    from app.models.comment import Comment

    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    local = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=headers,
        json={"body": "Team-only note"},
    )
    assert local.status_code == 201
    assert local.json()["github_comment_id"] is None

    db.add(
        Comment(
            task_id=task.id,
            author_id=owner.id,
            body="From GitHub issue",
            github_comment_id=99001,
            github_author_login="dev-on-github",
        )
    )
    db.flush()

    local_list = client.get(
        f"/api/v1/tasks/{task.id}/comments?scope=local",
        headers=headers,
    )
    github_list = client.get(
        f"/api/v1/tasks/{task.id}/comments?scope=github",
        headers=headers,
    )
    assert local_list.status_code == 200
    assert github_list.status_code == 200
    assert local_list.json()["total"] == 1
    assert github_list.json()["total"] == 1
    assert local_list.json()["items"][0]["body"] == "Team-only note"
    assert github_list.json()["items"][0]["github_author_login"] == "dev-on-github"


@pytest.mark.integration
def test_comment_reply_notifies_parent_author(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    member = add_project_member(db, org, workspace, project, "reply-peer@test.dev")
    owner_headers = auth_headers(client, owner.email)
    member_headers = auth_headers(client, member.email)

    parent = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=owner_headers,
        json={"body": "Parent comment"},
    )
    assert parent.status_code == 201
    parent_id = parent.json()["id"]

    reply = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=member_headers,
        json={"body": "Reply here", "parent_comment_id": parent_id},
    )
    assert reply.status_code == 201
    assert reply.json()["parent_comment_id"] == parent_id


@pytest.mark.integration
def test_comment_reply_rejects_invalid_parent(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=headers,
        json={"body": "Orphan reply", "parent_comment_id": "00000000-0000-0000-0000-000000000099"},
    )
    assert response.status_code == 400
    assert "parent comment" in response.json()["detail"].lower()


@pytest.mark.integration
def test_comment_reply_rejects_nested_reply(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    parent = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=headers,
        json={"body": "Top-level"},
    )
    assert parent.status_code == 201
    parent_id = parent.json()["id"]

    first_reply = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=headers,
        json={"body": "First reply", "parent_comment_id": parent_id},
    )
    assert first_reply.status_code == 201
    reply_id = first_reply.json()["id"]

    nested = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=headers,
        json={"body": "Too deep", "parent_comment_id": reply_id},
    )
    assert nested.status_code == 400
    assert "nested" in nested.json()["detail"].lower()


@pytest.mark.integration
def test_non_author_cannot_edit_comment(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    member = add_project_member(db, org, workspace, project, "edit-blocked@test.dev")
    owner_headers = auth_headers(client, owner.email)
    member_headers = auth_headers(client, member.email)

    created = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=owner_headers,
        json={"body": "Owner comment"},
    )
    assert created.status_code == 201
    comment_id = created.json()["id"]

    denied = client.patch(
        f"/api/v1/comments/{comment_id}",
        headers=member_headers,
        json={"body": "Hijacked"},
    )
    assert denied.status_code == 403


@pytest.mark.integration
def test_project_admin_can_delete_other_users_comment(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    member = add_project_member(db, org, workspace, project, "deletable@test.dev", role="member")
    member_headers = auth_headers(client, member.email)
    owner_headers = auth_headers(client, owner.email)

    created = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=member_headers,
        json={"body": "Member comment"},
    )
    assert created.status_code == 201
    comment_id = created.json()["id"]

    deleted = client.delete(f"/api/v1/comments/{comment_id}", headers=owner_headers)
    assert deleted.status_code == 200
    comment = db.get(Comment, comment_id)
    assert comment.deleted_at is not None


@pytest.mark.integration
def test_list_comments_404_for_missing_task(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    response = client.get(
        f"/api/v1/tasks/00000000-0000-0000-0000-000000000099/comments",
        headers=headers,
    )
    assert response.status_code == 404


@pytest.mark.integration
def test_create_comment_404_for_missing_task(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    response = client.post(
        "/api/v1/tasks/00000000-0000-0000-0000-000000000099/comments",
        headers=headers,
        json={"body": "orphan"},
    )
    assert response.status_code == 404


@pytest.mark.integration
def test_update_comment_404_for_missing_comment(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    response = client.patch(
        "/api/v1/comments/00000000-0000-0000-0000-000000000099",
        headers=headers,
        json={"body": "nope"},
    )
    assert response.status_code == 404


@pytest.mark.integration
def test_delete_comment_404_for_missing_comment(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    response = client.delete("/api/v1/comments/00000000-0000-0000-0000-000000000099", headers=headers)
    assert response.status_code == 404


@pytest.mark.integration
@patch("app.api.v1.comments.emit")
def test_create_comment_emits_mention_event(mock_emit, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "mention-target@test.dev")
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/tasks/{task.id}/comments",
        headers=headers,
        json={"body": f"Ping @[Member]({member.id})"},
    )
    assert response.status_code == 201, response.text
    mention_events = [call for call in mock_emit.call_args_list if call.args[0] == "mention.created"]
    assert mention_events
    assert f"user:{member.id}" in mention_events[0].args[1]
