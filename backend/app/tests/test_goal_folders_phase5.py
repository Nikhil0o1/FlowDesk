"""Phase 5 — folder archive, share ACL, activity, notifications, search."""

from sqlalchemy import select

from app.models.activity import ActivityLog
from app.models.notification import Notification
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, build_project_stack
from app.models.organization import OrganizationMember
from app.models.workspace import WorkspaceMember


def test_archive_and_unarchive_folder(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Archive me"},
    ).json()
    folder_id = folder["id"]

    archived = client.patch(
        f"/api/v1/goal-folders/{folder_id}",
        headers=headers,
        json={"is_archived": True},
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["is_archived"] is True
    assert archived.json()["archived_at"] is not None

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goal-folders", headers=headers)
    assert listed.status_code == 200
    assert all(f["id"] != folder_id for f in listed.json())

    with_archived = client.get(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        params={"include_archived": "true"},
    )
    assert with_archived.status_code == 200
    assert any(f["id"] == folder_id and f["is_archived"] for f in with_archived.json())

    restored = client.patch(
        f"/api/v1/goal-folders/{folder_id}",
        headers=headers,
        json={"is_archived": False},
    )
    assert restored.status_code == 200
    assert restored.json()["is_archived"] is False
    assert restored.json()["archived_at"] is None

    actions = {
        a.action
        for a in db.scalars(
            select(ActivityLog).where(ActivityLog.workspace_id == workspace.id)
        ).all()
    }
    assert "goal_folder.archived" in actions
    assert "goal_folder.unarchived" in actions


def test_private_folder_share_acl(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "folder-share@test.dev")
    owner_headers = auth_headers(client, "owner@test.dev")
    member_headers = auth_headers(client, "folder-share@test.dev")

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=owner_headers,
        json={"name": "Secret", "is_private": True},
    ).json()
    folder_id = folder["id"]
    assert folder["is_private"] is True

    assert client.get(f"/api/v1/goal-folders/{folder_id}", headers=member_headers).status_code == 404

    share = client.post(
        f"/api/v1/goal-folders/{folder_id}/share/members",
        headers=owner_headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert share.status_code == 201, share.text
    assert any(m["user_id"] == str(member.id) for m in share.json()["members"])

    viewed = client.get(f"/api/v1/goal-folders/{folder_id}", headers=member_headers)
    assert viewed.status_code == 200
    assert viewed.json()["id"] == folder_id

    access = client.get(f"/api/v1/workspaces/{workspace.id}/goals/access", headers=member_headers)
    assert access.status_code == 200
    assert access.json()["can_access"] is True

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goal-folders", headers=member_headers)
    assert listed.status_code == 200
    assert any(f["id"] == folder_id for f in listed.json())

    notifs = db.scalars(
        select(Notification).where(
            Notification.user_id == member.id,
            Notification.type == "goal_folder_shared",
        )
    ).all()
    assert len(notifs) == 1

    removed = client.delete(
        f"/api/v1/goal-folders/{folder_id}/share/members/{member.id}",
        headers=owner_headers,
    )
    assert removed.status_code == 200
    assert client.get(f"/api/v1/goal-folders/{folder_id}", headers=member_headers).status_code == 404


def test_goal_folder_share_member_role_can_be_updated(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "folder-role@test.dev")
    owner_headers = auth_headers(client, "owner@test.dev")

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=owner_headers,
        json={"name": "Role Test", "is_private": True},
    ).json()
    folder_id = folder["id"]

    share = client.post(
        f"/api/v1/goal-folders/{folder_id}/share/members",
        headers=owner_headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert share.status_code == 201, share.text

    updated = client.patch(
        f"/api/v1/goal-folders/{folder_id}/share/members/{member.id}",
        headers=owner_headers,
        json={"role": "editor"},
    )
    assert updated.status_code == 200, updated.text
    row = next(m for m in updated.json()["members"] if m["user_id"] == str(member.id))
    assert row["role"] == "editor"


def test_goal_shared_notification(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "goal-share@test.dev")
    owner_headers = auth_headers(client, "owner@test.dev")

    goal = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={"name": "Shared Goal", "owner_id": str(owner.id), "is_private": True},
    ).json()

    shared = client.post(
        f"/api/v1/goals/{goal['id']}/share/members",
        headers=owner_headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert shared.status_code == 201, shared.text

    notifs = db.scalars(
        select(Notification).where(
            Notification.user_id == member.id,
            Notification.type == "goal_shared",
        )
    ).all()
    assert len(notifs) == 1


def test_goal_completed_notifies_owner(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    # Give another admin manage rights via workspace admin
    other = make_user(db, "goal-complete@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=other.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=other.id, role="admin"))
    db.flush()

    owner_headers = auth_headers(client, "owner@test.dev")
    other_headers = auth_headers(client, "goal-complete@test.dev")

    goal = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={"name": "Finish me", "owner_id": str(owner.id)},
    ).json()

    completed = client.patch(
        f"/api/v1/goals/{goal['id']}",
        headers=other_headers,
        json={"status": "completed"},
    )
    assert completed.status_code == 200, completed.text

    notifs = db.scalars(
        select(Notification).where(
            Notification.user_id == owner.id,
            Notification.type == "goal_completed",
        )
    ).all()
    assert len(notifs) == 1


def test_search_goals_and_folders(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Zephyr Folder Search"},
    ).json()
    goal = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Zephyr Goal Search", "owner_id": str(owner.id)},
    ).json()

    # Archive the folder — should not appear in search
    client.patch(
        f"/api/v1/goal-folders/{folder['id']}",
        headers=headers,
        json={"is_archived": True},
    )
    live_folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Zephyr Live Folder"},
    ).json()

    results = client.get("/api/v1/search", headers=headers, params={"q": "Zephyr"})
    assert results.status_code == 200, results.text
    body = results.json()
    goal_ids = {g["id"] for g in body.get("goals", [])}
    folder_ids = {f["id"] for f in body.get("goal_folders", [])}
    assert goal["id"] in goal_ids
    assert live_folder["id"] in folder_ids
    assert folder["id"] not in folder_ids


def test_folder_create_activity_and_goal_in_folder(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Activity Folder"},
    ).json()

    goal = client.post(
        f"/api/v1/goal-folders/{folder['id']}/goals",
        headers=headers,
        json={"name": "Nested goal", "owner_id": str(owner.id)},
    )
    assert goal.status_code == 201, goal.text

    actions = [
        a.action
        for a in db.scalars(
            select(ActivityLog).where(ActivityLog.workspace_id == workspace.id)
        ).all()
    ]
    assert "goal_folder.created" in actions
    assert "goal.created" in actions
