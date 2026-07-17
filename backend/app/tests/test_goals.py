"""Goal API integration tests."""
from datetime import date, timedelta

from sqlalchemy import select

from app.models.organization import OrganizationMember
from app.models.project import ProjectMember, SpaceMember
from app.models.workspace import WorkspaceMember
from app.services.personal_list_service import get_or_create_personal_project
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, build_project_stack


def test_goal_crud_flow(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    goal_owner = add_project_member(db, org, workspace, project, "goal-owner@test.dev", role="member")
    headers = auth_headers(client, "owner@test.dev")
    start = date.today()
    due = start + timedelta(days=30)

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={
            "name": "Q3 Launch",
            "description": "Ship goals feature",
            "owner_id": str(goal_owner.id),
            "start_date": start.isoformat(),
            "due_date": due.isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    goal = created.json()
    assert goal["name"] == "Q3 Launch"
    assert goal["owner_id"] == str(goal_owner.id)
    assert goal["progress"] == "0.00"
    assert goal["status"] == "active"

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=headers)
    assert listed.status_code == 200
    assert any(item["id"] == goal["id"] for item in listed.json())

    detail = client.get(f"/api/v1/goals/{goal['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["targets"] == []

    target = client.post(
        f"/api/v1/goals/{goal['id']}/targets",
        headers=headers,
        json={"title": "Backend", "owner_id": str(owner.id)},
    )
    assert target.status_code == 201, target.text
    target_id = target.json()["id"]

    detail = client.get(f"/api/v1/goals/{goal['id']}", headers=headers)
    assert detail.status_code == 200
    assert len(detail.json()["targets"]) == 1
    assert detail.json()["targets"][0]["title"] == "Backend"

    progress = client.get(f"/api/v1/goals/{goal['id']}/progress", headers=headers)
    assert progress.status_code == 200
    assert progress.json()["goal_id"] == goal["id"]
    assert len(progress.json()["targets"]) == 1

    updated = client.patch(
        f"/api/v1/goals/{goal['id']}",
        headers=headers,
        json={"name": "Q3 Launch v2"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Q3 Launch v2"

    target_updated = client.patch(
        f"/api/v1/targets/{target_id}",
        headers=headers,
        json={"title": "Backend APIs"},
    )
    assert target_updated.status_code == 200
    assert target_updated.json()["title"] == "Backend APIs"

    deleted_target = client.delete(f"/api/v1/targets/{target_id}", headers=headers)
    assert deleted_target.status_code == 200

    deleted = client.delete(f"/api/v1/goals/{goal['id']}", headers=headers)
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/goals/{goal['id']}", headers=headers).status_code == 404


def test_workspace_member_cannot_access_goals_section(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = make_user(db, "goal-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, "goal-member@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Blocked goal", "owner_id": str(member.id)},
    )
    assert response.status_code == 403

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=headers)
    assert listed.status_code == 403


def test_goal_owner_can_update_goal(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    goal_owner = add_project_member(db, org, workspace, project, "goal-owner-edit@test.dev", role="member")
    admin_headers = auth_headers(client, "owner@test.dev")
    owner_headers = auth_headers(client, "goal-owner-edit@test.dev")

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=admin_headers,
        json={"name": "Owner managed", "owner_id": str(goal_owner.id)},
    )
    assert created.status_code == 201
    goal_id = created.json()["id"]

    updated = client.patch(
        f"/api/v1/goals/{goal_id}",
        headers=owner_headers,
        json={"description": "Updated by owner"},
    )
    assert updated.status_code == 200
    assert updated.json()["description"] == "Updated by owner"

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=owner_headers)
    assert listed.status_code == 200
    assert any(g["id"] == goal_id for g in listed.json())

    viewed = client.get(f"/api/v1/goals/{goal_id}", headers=owner_headers)
    assert viewed.status_code == 200


def test_org_admin_sees_all_goals(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    other_admin = add_project_member(db, org, workspace, project, "other-goal@test.dev", role="member")
    headers = auth_headers(client, "owner@test.dev")

    first = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Goal A", "owner_id": str(other_admin.id)},
    )
    assert first.status_code == 201
    second = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Goal B", "owner_id": str(owner.id)},
    )
    assert second.status_code == 201

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=headers)
    assert listed.status_code == 200
    names = {item["name"] for item in listed.json()}
    assert names == {"Goal A", "Goal B"}


def test_project_admin_sees_only_owned_or_created_goals(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    project_admin = add_project_member(
        db, org, workspace, project, "scoped-goal-admin@test.dev", role="admin"
    )
    other_user = add_project_member(db, org, workspace, project, "other-goal-user@test.dev", role="member")
    owner_headers = auth_headers(client, "owner@test.dev")
    admin_headers = auth_headers(client, "scoped-goal-admin@test.dev")

    owned = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=admin_headers,
        json={"name": "Admin owned", "owner_id": str(project_admin.id)},
    )
    assert owned.status_code == 201

    hidden = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={"name": "Org only", "owner_id": str(other_user.id), "is_private": True},
    )
    assert hidden.status_code == 201

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=admin_headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["name"] == "Admin owned"

    cannot_view = client.get(f"/api/v1/goals/{hidden.json()['id']}", headers=admin_headers)
    assert cannot_view.status_code == 404


def test_workspace_shared_goal_visible_to_section_admins(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    project_admin = add_project_member(
        db, org, workspace, project, "shared-goal-admin@test.dev", role="admin"
    )
    other_user = add_project_member(db, org, workspace, project, "shared-goal-owner@test.dev", role="member")
    owner_headers = auth_headers(client, "owner@test.dev")
    admin_headers = auth_headers(client, "shared-goal-admin@test.dev")

    shared = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={"name": "Workspace goal", "owner_id": str(other_user.id), "is_private": False},
    )
    assert shared.status_code == 201
    goal_id = shared.json()["id"]

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=admin_headers)
    assert listed.status_code == 200
    assert any(g["id"] == goal_id for g in listed.json())
    assert client.get(f"/api/v1/goals/{goal_id}", headers=admin_headers).status_code == 200


def test_share_goal_with_member_and_make_private(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "share-member@test.dev", role="member")
    owner_headers = auth_headers(client, "owner@test.dev")
    member_headers = auth_headers(client, "share-member@test.dev")

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={"name": "Private share", "owner_id": str(owner.id), "is_private": True},
    )
    assert created.status_code == 201
    goal_id = created.json()["id"]

    assert client.get(f"/api/v1/goals/{goal_id}", headers=member_headers).status_code == 404

    added = client.post(
        f"/api/v1/goals/{goal_id}/share/members",
        headers=owner_headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert added.status_code == 201, added.text
    assert len(added.json()["members"]) == 1
    assert client.get(f"/api/v1/goals/{goal_id}", headers=member_headers).status_code == 200

    privatized = client.patch(
        f"/api/v1/goals/{goal_id}/share",
        headers=owner_headers,
        json={"is_private": True},
    )
    assert privatized.status_code == 200
    assert privatized.json()["is_private"] is True
    # Explicit share member still retains access
    assert client.get(f"/api/v1/goals/{goal_id}", headers=member_headers).status_code == 200


def test_create_number_and_true_false_targets(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")
    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Typed targets", "owner_id": str(owner.id)},
    )
    goal_id = created.json()["id"]

    number = client.post(
        f"/api/v1/goals/{goal_id}/targets",
        headers=headers,
        json={
            "title": "Ship 10",
            "owner_id": str(owner.id),
            "target_type": "number",
            "start_value": 0,
            "target_value": 10,
            "current_value": 5,
        },
    )
    assert number.status_code == 201, number.text
    assert number.json()["target_type"] == "number"
    assert float(number.json()["progress"]) == 50.0

    tf = client.post(
        f"/api/v1/goals/{goal_id}/targets",
        headers=headers,
        json={
            "title": "Launch",
            "owner_id": str(owner.id),
            "target_type": "true_false",
            "is_completed": False,
        },
    )
    assert tf.status_code == 201, tf.text
    assert tf.json()["target_type"] == "true_false"
    assert float(tf.json()["progress"]) == 0.0

    done = client.patch(
        f"/api/v1/targets/{tf.json()['id']}",
        headers=headers,
        json={"is_completed": True},
    )
    assert done.status_code == 200
    assert float(done.json()["progress"]) == 100.0

    progress = client.get(f"/api/v1/goals/{goal_id}/progress", headers=headers)
    assert progress.status_code == 200
    assert float(progress.json()["progress"]) == 75.0


def test_goal_color_archive_and_folder(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")
    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Colored", "owner_id": str(owner.id)},
    )
    goal_id = created.json()["id"]

    colored = client.patch(f"/api/v1/goals/{goal_id}", headers=headers, json={"color": "#3b82f6"})
    assert colored.status_code == 200
    assert colored.json()["color"] == "#3b82f6"

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Q3"},
    )
    assert folder.status_code == 201, folder.text
    folder_id = folder.json()["id"]

    moved = client.patch(f"/api/v1/goals/{goal_id}", headers=headers, json={"folder_id": folder_id})
    assert moved.status_code == 200
    assert moved.json()["folder_id"] == folder_id

    archived = client.patch(f"/api/v1/goals/{goal_id}", headers=headers, json={"status": "archived"})
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goal-folders", headers=headers)
    assert listed.status_code == 200
    assert any(f["id"] == folder_id for f in listed.json())


def test_creator_can_view_goal_without_section_access(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "goal-creator-view@test.dev", role="member")
    project_admin = add_project_member(
        db, org, workspace, project, "goal-creator-admin@test.dev", role="admin"
    )
    admin_headers = auth_headers(client, "goal-creator-admin@test.dev")
    member_headers = auth_headers(client, "goal-creator-view@test.dev")

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=admin_headers,
        json={"name": "Created for member", "owner_id": str(member.id)},
    )
    assert created.status_code == 201
    goal_id = created.json()["id"]

    assert client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=member_headers).status_code == 200
    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=member_headers)
    assert any(g["id"] == goal_id for g in listed.json())
    assert client.get(f"/api/v1/goals/{goal_id}", headers=member_headers).status_code == 200


def test_share_goal_member_can_list_goal(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "share-list@test.dev", role="member")
    owner_headers = auth_headers(client, "owner@test.dev")
    member_headers = auth_headers(client, "share-list@test.dev")

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={"name": "Shared list test", "owner_id": str(owner.id), "is_private": True},
    )
    assert created.status_code == 201
    goal_id = created.json()["id"]

    assert client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=member_headers).status_code == 403

    added = client.post(
        f"/api/v1/goals/{goal_id}/share/members",
        headers=owner_headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert added.status_code == 201, added.text

    access = client.get(f"/api/v1/workspaces/{workspace.id}/goals/access", headers=member_headers)
    assert access.status_code == 200
    assert access.json()["can_access"] is True
    assert access.json()["explicit_access"] is True
    assert access.json()["section_access"] is False

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=member_headers)
    assert listed.status_code == 200
    assert any(g["id"] == goal_id for g in listed.json())


def test_project_admin_can_create_goal(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    project_admin = add_project_member(
        db, org, workspace, project, "project-admin-goal@test.dev", role="admin"
    )
    headers = auth_headers(client, "project-admin-goal@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Project admin goal", "owner_id": str(project_admin.id)},
    )
    assert response.status_code == 201, response.text


def test_goals_access_plain_member_without_shares(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "no-goal-access@test.dev", role="member")
    member_headers = auth_headers(client, "no-goal-access@test.dev")

    access = client.get(f"/api/v1/workspaces/{workspace.id}/goals/access", headers=member_headers)
    assert access.status_code == 200
    body = access.json()
    assert body["section_access"] is False
    assert body["explicit_access"] is False
    assert body["can_access"] is False

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=member_headers)
    assert listed.status_code == 403

    folders = client.get(f"/api/v1/workspaces/{workspace.id}/goal-folders", headers=member_headers)
    assert folders.status_code == 403


def test_goals_access_section_admin(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    project_admin = add_project_member(
        db, org, workspace, project, "goal-section-admin@test.dev", role="admin"
    )
    headers = auth_headers(client, "goal-section-admin@test.dev")

    access = client.get(f"/api/v1/workspaces/{workspace.id}/goals/access", headers=headers)
    assert access.status_code == 200
    body = access.json()
    assert body["section_access"] is True
    assert body["can_access"] is True


def test_folder_share_member_sees_goals_in_shared_folder(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "folder-goals@test.dev", role="member")
    owner_headers = auth_headers(client, "owner@test.dev")
    member_headers = auth_headers(client, "folder-goals@test.dev")

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=owner_headers,
        json={"name": "Shared folder goals", "is_private": True},
    ).json()
    folder_id = folder["id"]

    goal = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={
            "name": "Inside shared folder",
            "owner_id": str(owner.id),
            "folder_id": folder_id,
            "is_private": True,
        },
    )
    assert goal.status_code == 201, goal.text
    goal_id = goal.json()["id"]

    assert client.get(f"/api/v1/goals/{goal_id}", headers=member_headers).status_code == 404

    share = client.post(
        f"/api/v1/goal-folders/{folder_id}/share/members",
        headers=owner_headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert share.status_code == 201, share.text

    viewed = client.get(f"/api/v1/goal-folders/{folder_id}", headers=member_headers)
    assert viewed.status_code == 200
    goal_ids = {g["id"] for g in viewed.json()["goals"]}
    assert goal_id in goal_ids

    assert client.get(f"/api/v1/goals/{goal_id}", headers=member_headers).status_code == 200


def test_goals_list_status_filter(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    active = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Active goal", "owner_id": str(owner.id), "status": "active"},
    )
    assert active.status_code == 201, active.text

    archived = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Archived goal", "owner_id": str(owner.id), "status": "archived"},
    )
    assert archived.status_code == 201, archived.text

    listed = client.get(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        params={"status": "archived"},
    )
    assert listed.status_code == 200
    names = {g["name"] for g in listed.json()}
    assert names == {"Archived goal"}


def test_space_admin_can_create_goal(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    space_admin = make_user(db, "space-admin-goal@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=space_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=space_admin.id, role="member"))
    db.add(SpaceMember(space_id=project.space_id, user_id=space_admin.id, role="admin"))
    db.flush()
    headers = auth_headers(client, "space-admin-goal@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Space admin goal", "owner_id": str(space_admin.id)},
    )
    assert response.status_code == 201, response.text


def test_create_goal_requires_workspace_member_owner(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    outsider = make_user(db, "outsider-goal@test.dev")
    db.flush()
    headers = auth_headers(client, "owner@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Bad owner", "owner_id": str(outsider.id)},
    )
    assert response.status_code == 422


def test_personal_list_admin_cannot_access_goals_section(client, db, org, owner):
    """Personal List makes every member a project admin — that must not unlock Goals."""
    workspace, project = build_project_stack(db, org, owner)
    member = make_user(db, "personal-only-goals@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    personal = get_or_create_personal_project(db, workspace_id=workspace.id, user_id=member.id)
    assert personal.is_personal is True
    membership = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == personal.id,
            ProjectMember.user_id == member.id,
        )
    )
    assert membership is not None
    assert membership.role == "admin"

    owner_headers = auth_headers(client, "owner@test.dev")
    member_headers = auth_headers(client, "personal-only-goals@test.dev")

    shared = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={
            "name": "Visible to real admins",
            "owner_id": str(owner.id),
            "is_private": False,
            "description": "Should stay hidden from personal-list-only members",
        },
    )
    assert shared.status_code == 201
    goal_id = shared.json()["id"]

    assert client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=member_headers).status_code == 403
    assert (
        client.post(
            f"/api/v1/workspaces/{workspace.id}/goals",
            headers=member_headers,
            json={"name": "Nope", "owner_id": str(member.id)},
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/goals/{goal_id}", headers=member_headers).status_code == 404

    # Real non-personal project admin still has Goals access.
    add_project_member(
        db, org, workspace, project, "real-project-admin-goals@test.dev", role="admin"
    )
    admin_headers = auth_headers(client, "real-project-admin-goals@test.dev")
    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goals", headers=admin_headers)
    assert listed.status_code == 200
    assert any(g["id"] == goal_id for g in listed.json())

    # Personal List itself is unchanged for the member.
    personal_resp = client.get(
        f"/api/v1/me/personal-list?workspace_id={workspace.id}",
        headers=member_headers,
    )
    assert personal_resp.status_code == 200
    assert personal_resp.json()["is_personal"] is True
    assert personal_resp.json()["id"] == str(personal.id)


def test_goal_owner_candidates_lists_scoped_admins_only(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    plain = add_project_member(db, org, workspace, project, "plain-member@test.dev", role="member")
    project_admin = add_project_member(
        db, org, workspace, project, "project-admin-owner@test.dev", role="admin"
    )
    headers = auth_headers(client, "owner@test.dev")

    resp = client.get(
        f"/api/v1/workspaces/{workspace.id}/goal-owner-candidates",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    user_ids = {item["user_id"] for item in resp.json()}
    assert str(owner.id) in user_ids
    assert str(project_admin.id) in user_ids
    assert str(plain.id) not in user_ids
