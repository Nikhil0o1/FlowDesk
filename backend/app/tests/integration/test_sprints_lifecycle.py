"""Phase 3 integration — sprint lifecycle beyond basic CRUD."""
import pytest

from app.models.organization import OrganizationMember
from app.models.project import ProjectMember
from app.models.task import CustomStatus, TaskAssignee
from app.models.workspace import WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, add_task, build_project_stack


@pytest.mark.integration
def test_scrum_master_can_move_assigned_task_on_active_sprint_board(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    scrum_master = add_project_member(db, org, workspace, project, "scrum-master@test.dev", role="member")
    assignee = make_user(db, "assignee-sm@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=assignee.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=assignee.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=assignee.id, role="member"))
    db.flush()

    todo = CustomStatus(project_id=project.id, name="To do", category="todo", position=0)
    progress = CustomStatus(project_id=project.id, name="In progress", category="in_progress", position=1)
    db.add(todo)
    db.add(progress)
    task = add_task(db, project, owner, number=82)
    task.status_id = todo.id
    db.add(TaskAssignee(task_id=task.id, user_id=assignee.id, assigned_by=owner.id))
    db.flush()

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "SM Board Sprint", "scrum_master_id": str(scrum_master.id), "project_id": str(project.id)},
    )
    assert sprint.status_code == 201, sprint.text
    sprint_id = sprint.json()["id"]
    client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=owner_headers,
        json={"task_ids": [str(task.id)]},
    )

    sm_headers = auth_headers(client, scrum_master.email)
    blocked_while_planned = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=sm_headers,
        json={"status_id": str(progress.id)},
    )
    assert blocked_while_planned.status_code == 403

    client.post(f"/api/v1/sprints/{sprint_id}/start", headers=owner_headers)

    moved = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=sm_headers,
        json={"status_id": str(progress.id)},
    )
    assert moved.status_code == 200, moved.text

    other_member = add_project_member(db, org, workspace, project, "not-sm@test.dev", role="member")
    other_headers = auth_headers(client, other_member.email)
    blocked = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=other_headers,
        json={"status_id": str(todo.id)},
    )
    assert blocked.status_code == 403

    client.post(f"/api/v1/sprints/{sprint_id}/complete", headers=owner_headers)
    blocked_after_complete = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=sm_headers,
        json={"status_id": str(progress.id)},
    )
    assert blocked_after_complete.status_code == 403


@pytest.mark.integration
def test_scrum_master_can_reassign_on_active_sprint(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    scrum_master = add_project_member(db, org, workspace, project, "sm-reassign@test.dev", role="member")
    assignee = make_user(db, "assignee-reassign@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=assignee.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=assignee.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=assignee.id, role="member"))
    db.flush()

    task = add_task(db, project, owner, number=83)
    db.add(TaskAssignee(task_id=task.id, user_id=assignee.id, assigned_by=owner.id))
    db.flush()

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Reassign Sprint", "scrum_master_id": str(scrum_master.id), "project_id": str(project.id)},
    )
    sprint_id = sprint.json()["id"]
    client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=owner_headers,
        json={"task_ids": [str(task.id)]},
    )
    client.post(f"/api/v1/sprints/{sprint_id}/start", headers=owner_headers)

    sm_headers = auth_headers(client, scrum_master.email)
    new_member = add_project_member(db, org, workspace, project, "new-assignee@test.dev", role="member")

    added = client.post(
        f"/api/v1/tasks/{task.id}/assignees",
        headers=sm_headers,
        json={"user_ids": [str(new_member.id)]},
    )
    assert added.status_code == 200, added.text

    removed = client.delete(
        f"/api/v1/tasks/{task.id}/assignees/{assignee.id}",
        headers=sm_headers,
    )
    assert removed.status_code == 200, removed.text

    client.post(f"/api/v1/sprints/{sprint_id}/complete", headers=owner_headers)
    blocked = client.post(
        f"/api/v1/tasks/{task.id}/assignees",
        headers=sm_headers,
        json={"user_ids": [str(assignee.id)]},
    )
    assert blocked.status_code == 403


@pytest.mark.integration
def test_standup_follow_up_requires_scrum_master_or_admin(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    scrum_master = add_project_member(db, org, workspace, project, "sm-followup@test.dev", role="member")
    regular = add_project_member(db, org, workspace, project, "member-followup@test.dev", role="member")
    task = add_task(db, project, owner, number=91)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Follow-up Sprint", "scrum_master_id": str(scrum_master.id), "project_id": str(project.id)},
    )
    sprint_id = sprint.json()["id"]
    client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=owner_headers,
        json={"task_ids": [str(task.id)]},
    )
    client.post(f"/api/v1/sprints/{sprint_id}/start", headers=owner_headers)

    standup = client.post(
        f"/api/v1/sprints/{sprint_id}/standups",
        headers=auth_headers(client, regular.email),
        json={"for_date": "2024-06-30", "blockers": "Waiting on API access"},
    )
    assert standup.status_code == 201
    standup_id = standup.json()["id"]

    payload = {"task_id": str(task.id), "body": "@[user:regular] checking in"}
    blocked = client.post(
        f"/api/v1/sprints/{sprint_id}/standups/{standup_id}/follow-up",
        headers=auth_headers(client, regular.email),
        json=payload,
    )
    assert blocked.status_code == 403

    allowed = client.post(
        f"/api/v1/sprints/{sprint_id}/standups/{standup_id}/follow-up",
        headers=auth_headers(client, scrum_master.email),
        json=payload,
    )
    assert allowed.status_code == 201, allowed.text


@pytest.mark.integration
def test_scrum_master_can_set_story_points_on_sprint_task_only(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    scrum_master = add_project_member(db, org, workspace, project, "sm-points@test.dev", role="member")
    task = add_task(db, project, owner, number=84)
    task.is_private = True
    db.flush()

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Points Sprint", "scrum_master_id": str(scrum_master.id), "project_id": str(project.id)},
    )
    sprint_id = sprint.json()["id"]
    client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=owner_headers,
        json={"task_ids": [str(task.id)]},
    )

    sm_headers = auth_headers(client, scrum_master.email)
    blocked_title = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=sm_headers,
        json={"title": "SM cannot rename"},
    )
    assert blocked_title.status_code == 403

    points = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=sm_headers,
        json={"story_points": 5},
    )
    assert points.status_code == 200, points.text
    assert points.json()["story_points"] == 5

    not_in_sprint = add_task(db, project, owner, number=87)
    not_in_sprint.is_private = True
    db.flush()
    blocked_backlog = client.patch(
        f"/api/v1/tasks/{not_in_sprint.id}",
        headers=sm_headers,
        json={"story_points": 3},
    )
    assert blocked_backlog.status_code == 403


@pytest.mark.integration
def test_delegate_scrum_master_has_facilitation_powers(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    scrum_master = add_project_member(db, org, workspace, project, "sm-primary@test.dev", role="member")
    delegate = add_project_member(db, org, workspace, project, "sm-delegate@test.dev", role="member")
    todo = CustomStatus(project_id=project.id, name="To do", category="todo", position=0)
    progress = CustomStatus(project_id=project.id, name="In progress", category="in_progress", position=1)
    db.add(todo)
    db.add(progress)
    task = add_task(db, project, owner, number=85)
    task.status_id = todo.id
    db.flush()

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={
            "name": "Delegate Sprint",
            "scrum_master_id": str(scrum_master.id),
            "delegate_scrum_master_id": str(delegate.id),
            "project_id": str(project.id),
        },
    )
    sprint_id = sprint.json()["id"]
    client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=owner_headers,
        json={"task_ids": [str(task.id)]},
    )
    client.post(f"/api/v1/sprints/{sprint_id}/start", headers=owner_headers)

    delegate_headers = auth_headers(client, delegate.email)
    moved = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=delegate_headers,
        json={"status_id": str(progress.id)},
    )
    assert moved.status_code == 200, moved.text

    started = client.post(f"/api/v1/sprints/{sprint_id}/start", headers=delegate_headers)
    assert started.status_code in (200, 409)


@pytest.mark.integration
def test_scrum_master_can_move_task_between_sprints(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    scrum_master = add_project_member(db, org, workspace, project, "sm-move@test.dev", role="member")
    task = add_task(db, project, owner, number=86)

    sprint_a = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Sprint A", "scrum_master_id": str(scrum_master.id), "project_id": str(project.id)},
    ).json()["id"]
    sprint_b = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Sprint B", "scrum_master_id": str(scrum_master.id), "project_id": str(project.id)},
    ).json()["id"]
    client.post(
        f"/api/v1/sprints/{sprint_a}/tasks",
        headers=owner_headers,
        json={"task_ids": [str(task.id)]},
    )

    sm_headers = auth_headers(client, scrum_master.email)
    moved = client.post(
        f"/api/v1/sprints/{sprint_a}/tasks/{task.id}/move",
        headers=sm_headers,
        json={"target_sprint_id": sprint_b},
    )
    assert moved.status_code == 200, moved.text

    in_b = client.get(f"/api/v1/sprints/{sprint_b}/tasks", headers=owner_headers)
    assert any(t["id"] == str(task.id) for t in in_b.json())


@pytest.mark.integration
def test_scrum_master_can_resolve_standup_blocker(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    scrum_master = add_project_member(db, org, workspace, project, "sm-resolve@test.dev", role="member")
    member = add_project_member(db, org, workspace, project, "member-resolve@test.dev", role="member")

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Resolve Sprint", "scrum_master_id": str(scrum_master.id), "project_id": str(project.id)},
    )
    sprint_id = sprint.json()["id"]
    client.post(f"/api/v1/sprints/{sprint_id}/start", headers=owner_headers)

    standup = client.post(
        f"/api/v1/sprints/{sprint_id}/standups",
        headers=auth_headers(client, member.email),
        json={"for_date": "2024-07-01", "blockers": "Blocked on deploy"},
    )
    standup_id = standup.json()["id"]

    resolved = client.post(
        f"/api/v1/sprints/{sprint_id}/standups/{standup_id}/resolve-blocker",
        headers=auth_headers(client, scrum_master.email),
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["blocker_resolved_at"] is not None
    assert resolved.json()["blocker_resolved_by"] == str(scrum_master.id)


@pytest.mark.integration
def test_scope_lock_blocks_workspace_admin_from_adding_tasks(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    scrum_master = add_project_member(db, org, workspace, project, "sm-lock@test.dev", role="member")
    task = add_task(db, project, owner, number=88)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Locked Sprint", "scrum_master_id": str(scrum_master.id), "project_id": str(project.id)},
    )
    sprint_id = sprint.json()["id"]
    client.patch(
        f"/api/v1/sprints/{sprint_id}",
        headers=owner_headers,
        json={"scope_locked": True},
    )
    client.post(f"/api/v1/sprints/{sprint_id}/start", headers=owner_headers)

    blocked = client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=owner_headers,
        json={"task_ids": [str(task.id)]},
    )
    assert blocked.status_code == 403

    allowed = client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=auth_headers(client, scrum_master.email),
        json={"task_ids": [str(task.id)]},
    )
    assert allowed.status_code == 200, allowed.text


@pytest.mark.integration
def test_sprint_changes_and_summary(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Changes Sprint", "project_id": str(project.id)},
    )
    sprint_id = sprint.json()["id"]
    task = add_task(db, project, owner, number=89)
    client.post(
        f"/api/v1/sprints/{sprint_id}/tasks",
        headers=owner_headers,
        json={"task_ids": [str(task.id)]},
    )

    changes = client.get(f"/api/v1/sprints/{sprint_id}/changes", headers=owner_headers)
    assert changes.status_code == 200
    assert any(c["action"] == "sprint.task_added" for c in changes.json())

    summary = client.get(f"/api/v1/sprints/{sprint_id}/summary", headers=owner_headers)
    assert summary.status_code == 200
    assert summary.json()["total_tasks"] == 1


@pytest.mark.integration
def test_sprint_start_and_complete(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Sprint 1", "goal": "Ship"},
    )
    assert sprint.status_code == 201, sprint.text
    sprint_id = sprint.json()["id"]

    start = client.post(f"/api/v1/sprints/{sprint_id}/start", headers=headers)
    assert start.status_code == 200
    assert start.json()["status"] == "active"

    complete = client.post(f"/api/v1/sprints/{sprint_id}/complete", headers=headers)
    assert complete.status_code == 200
    assert complete.json()["sprint"]["status"] == "completed"
    assert "summary" in complete.json()


@pytest.mark.integration
def test_sprint_burndown(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Burndown Sprint"},
    )
    sprint_id = sprint.json()["id"]
    task = add_task(db, project, owner, number=80)
    client.post(f"/api/v1/sprints/{sprint_id}/tasks", headers=headers, json={"task_ids": [str(task.id)]})

    burndown = client.get(f"/api/v1/sprints/{sprint_id}/burndown", headers=headers)
    assert burndown.status_code == 200
    assert "points" in burndown.json() or isinstance(burndown.json(), list)


@pytest.mark.integration
def test_remove_task_from_sprint(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Remove Task Sprint"},
    )
    sprint_id = sprint.json()["id"]
    task = add_task(db, project, owner, number=81)
    client.post(f"/api/v1/sprints/{sprint_id}/tasks", headers=headers, json={"task_ids": [str(task.id)]})

    remove = client.delete(f"/api/v1/sprints/{sprint_id}/tasks/{task.id}", headers=headers)
    assert remove.status_code == 200


@pytest.mark.integration
def test_retrospective_only_after_complete_and_item_crud(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    owner_headers = auth_headers(client, owner.email)
    member = add_project_member(db, org, workspace, project, "retro-member@test.dev", role="member")
    other = add_project_member(db, org, workspace, project, "retro-other@test.dev", role="member")
    member_headers = auth_headers(client, member.email)
    other_headers = auth_headers(client, other.email)

    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=owner_headers,
        json={"name": "Retro Sprint", "project_id": str(project.id)},
    )
    assert sprint.status_code == 201, sprint.text
    sprint_id = sprint.json()["id"]

    blocked = client.get(f"/api/v1/sprints/{sprint_id}/retrospective", headers=owner_headers)
    assert blocked.status_code == 409

    client.post(f"/api/v1/sprints/{sprint_id}/start", headers=owner_headers)
    blocked_active = client.post(
        f"/api/v1/sprints/{sprint_id}/retrospective/items",
        headers=member_headers,
        json={"category": "rose", "body": "Too early"},
    )
    assert blocked_active.status_code == 409

    complete = client.post(f"/api/v1/sprints/{sprint_id}/complete", headers=owner_headers)
    assert complete.status_code == 200

    retro = client.get(f"/api/v1/sprints/{sprint_id}/retrospective", headers=member_headers)
    assert retro.status_code == 200, retro.text
    data = retro.json()
    assert data["sprint_id"] == sprint_id
    assert data["summary"] is not None
    assert data["items"] == []

    notes = client.patch(
        f"/api/v1/sprints/{sprint_id}/retrospective",
        headers=owner_headers,
        json={"stage_notes": "Focus on collaboration, not blame."},
    )
    assert notes.status_code == 200
    assert notes.json()["stage_notes"] == "Focus on collaboration, not blame."

    rose = client.post(
        f"/api/v1/sprints/{sprint_id}/retrospective/items",
        headers=member_headers,
        json={"category": "rose", "body": "Standups stayed short"},
    )
    assert rose.status_code == 201, rose.text
    rose_id = rose.json()["id"]

    bud = client.post(
        f"/api/v1/sprints/{sprint_id}/retrospective/items",
        headers=member_headers,
        json={"category": "bud", "body": "Clarify acceptance criteria", "assignee_id": str(other.id)},
    )
    assert bud.status_code == 201, bud.text
    bud_id = bud.json()["id"]
    assert bud.json()["assignee_id"] == str(other.id)
    assert bud.json()["is_done"] is False

    # Other member cannot edit author's rose
    forbidden = client.patch(
        f"/api/v1/sprints/{sprint_id}/retrospective/items/{rose_id}",
        headers=other_headers,
        json={"body": "Hijacked"},
    )
    assert forbidden.status_code == 403

    # Author can toggle bud done
    done = client.patch(
        f"/api/v1/sprints/{sprint_id}/retrospective/items/{bud_id}",
        headers=member_headers,
        json={"is_done": True},
    )
    assert done.status_code == 200
    assert done.json()["is_done"] is True

    # Workspace admin (owner) can delete another member's item
    deleted = client.delete(
        f"/api/v1/sprints/{sprint_id}/retrospective/items/{rose_id}",
        headers=owner_headers,
    )
    assert deleted.status_code == 200

    listing = client.get(f"/api/v1/sprints/{sprint_id}/retrospective", headers=owner_headers)
    assert listing.status_code == 200
    assert len(listing.json()["items"]) == 1
    assert listing.json()["items"][0]["id"] == bud_id
