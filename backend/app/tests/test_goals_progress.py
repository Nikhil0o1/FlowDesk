"""Goal task linking and automatic progress tests."""
from datetime import date, timedelta

from app.models.task import CustomStatus
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack


def _create_goal_with_target(client, workspace, owner_id, headers):
    goal = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={
            "name": "Progress Goal",
            "owner_id": str(owner_id),
            "start_date": date.today().isoformat(),
            "due_date": (date.today() + timedelta(days=30)).isoformat(),
        },
    )
    assert goal.status_code == 201, goal.text
    goal_id = goal.json()["id"]
    target = client.post(
        f"/api/v1/goals/{goal_id}/targets",
        headers=headers,
        json={"title": "Delivery", "owner_id": str(owner_id)},
    )
    assert target.status_code == 201, target.text
    return goal_id, target.json()["id"]


def test_link_tasks_and_progress_updates(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    goal_owner = add_project_member(db, org, workspace, project, "goal-progress-owner@test.dev")
    headers = auth_headers(client, "owner@test.dev")

    todo = CustomStatus(project_id=project.id, name="To do", category="todo", position=0)
    done = CustomStatus(project_id=project.id, name="Done", category="done", position=1)
    db.add_all([todo, done])
    db.flush()

    task_a = add_task(db, project, owner, title="Task A", number=1)
    task_b = add_task(db, project, owner, title="Task B", number=2)
    task_a.status_id = todo.id
    task_b.status_id = todo.id
    db.flush()

    goal_id, target_id = _create_goal_with_target(client, workspace, goal_owner.id, headers)

    linked = client.post(
        f"/api/v1/targets/{target_id}/tasks",
        headers=headers,
        json={"task_ids": [str(task_a.id), str(task_b.id)]},
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["detail"] == "2 task(s) linked to target"

    listed = client.get(f"/api/v1/targets/{target_id}/tasks", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    progress = client.get(f"/api/v1/goals/{goal_id}/progress", headers=headers)
    assert progress.status_code == 200
    assert progress.json()["progress"] == "0.00"

    updated = client.patch(
        f"/api/v1/tasks/{task_a.id}",
        headers=headers,
        json={"status_id": str(done.id)},
    )
    assert updated.status_code == 200, updated.text

    progress = client.get(f"/api/v1/goals/{goal_id}/progress", headers=headers)
    assert progress.status_code == 200
    assert progress.json()["progress"] == "50.00"
    assert progress.json()["targets"][0]["progress"] == "50.00"

    detail = client.get(f"/api/v1/goals/{goal_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["progress"] == "50.00"


def test_task_cannot_link_to_second_goal(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    goal_owner = add_project_member(db, org, workspace, project, "goal-dup-owner@test.dev")
    headers = auth_headers(client, "owner@test.dev")
    task = add_task(db, project, owner, title="Shared task", number=1)

    goal_one_id, target_one_id = _create_goal_with_target(client, workspace, goal_owner.id, headers)
    goal_two_id, target_two_id = _create_goal_with_target(client, workspace, goal_owner.id, headers)

    first = client.post(
        f"/api/v1/targets/{target_one_id}/tasks",
        headers=headers,
        json={"task_ids": [str(task.id)]},
    )
    assert first.status_code == 200, first.text

    second = client.post(
        f"/api/v1/targets/{target_two_id}/tasks",
        headers=headers,
        json={"task_ids": [str(task.id)]},
    )
    assert second.status_code == 409
    assert "already linked to goal Progress Goal" in second.json()["detail"]


def test_unlink_task_recalculates_progress(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    goal_owner = add_project_member(db, org, workspace, project, "goal-unlink-owner@test.dev")
    headers = auth_headers(client, "owner@test.dev")

    done = CustomStatus(project_id=project.id, name="Done", category="done", position=0)
    db.add(done)
    db.flush()

    task = add_task(db, project, owner, title="Only task", number=1)
    task.status_id = done.id
    db.flush()

    goal_id, target_id = _create_goal_with_target(client, workspace, goal_owner.id, headers)
    client.post(
        f"/api/v1/targets/{target_id}/tasks",
        headers=headers,
        json={"task_ids": [str(task.id)]},
    )

    progress = client.get(f"/api/v1/goals/{goal_id}/progress", headers=headers)
    assert progress.json()["progress"] == "100.00"

    unlinked = client.delete(f"/api/v1/targets/{target_id}/tasks/{task.id}", headers=headers)
    assert unlinked.status_code == 200

    progress = client.get(f"/api/v1/goals/{goal_id}/progress", headers=headers)
    assert progress.json()["progress"] == "0.00"


def test_goal_auto_completes_at_one_hundred_percent(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    goal_owner = add_project_member(db, org, workspace, project, "goal-complete-owner@test.dev")
    headers = auth_headers(client, "owner@test.dev")

    done = CustomStatus(project_id=project.id, name="Done", category="done", position=0)
    db.add(done)
    db.flush()
    task = add_task(db, project, owner, title="Finish", number=1)
    task.status_id = done.id
    db.flush()

    goal_id, target_id = _create_goal_with_target(client, workspace, goal_owner.id, headers)
    client.post(
        f"/api/v1/targets/{target_id}/tasks",
        headers=headers,
        json={"task_ids": [str(task.id)]},
    )

    detail = client.get(f"/api/v1/goals/{goal_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["status"] == "completed"
    assert detail.json()["progress"] == "100.00"


def test_folder_progress_updates_when_linked_task_completes(client, db, org, owner):
    """Phase 3: targets → link tasks → auto progress → folder average."""
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    todo = CustomStatus(project_id=project.id, name="To do", category="todo", position=0)
    done = CustomStatus(project_id=project.id, name="Done", category="done", position=1)
    db.add_all([todo, done])
    db.flush()

    task_a = add_task(db, project, owner, title="Folder task A", number=101)
    task_b = add_task(db, project, owner, title="Folder task B", number=102)
    task_a.status_id = todo.id
    task_b.status_id = todo.id
    db.flush()

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Phase 3 Folder"},
    ).json()

    goal = client.post(
        f"/api/v1/goal-folders/{folder['id']}/goals",
        headers=headers,
        json={"name": "Folder goal", "owner_id": str(owner.id)},
    )
    assert goal.status_code == 201, goal.text
    goal_id = goal.json()["id"]

    target = client.post(
        f"/api/v1/goals/{goal_id}/targets",
        headers=headers,
        json={"title": "Ship tasks", "target_type": "tasks", "owner_id": str(owner.id)},
    )
    assert target.status_code == 201, target.text
    assert target.json()["target_type"] == "tasks"
    target_id = target.json()["id"]

    linked = client.post(
        f"/api/v1/targets/{target_id}/tasks",
        headers=headers,
        json={"task_ids": [str(task_a.id), str(task_b.id)]},
    )
    assert linked.status_code == 200, linked.text

    links = client.get(f"/api/v1/workspaces/{workspace.id}/goal-task-links", headers=headers)
    assert links.status_code == 200
    linked_ids = {row["task_id"] for row in links.json()}
    assert str(task_a.id) in linked_ids
    assert str(task_b.id) in linked_ids

    before = client.get(f"/api/v1/goal-folders/{folder['id']}", headers=headers)
    assert before.status_code == 200
    assert float(before.json()["progress"]) == 0.0
    assert before.json()["goal_count"] == 1

    done_resp = client.patch(
        f"/api/v1/tasks/{task_a.id}",
        headers=headers,
        json={"status_id": str(done.id)},
    )
    assert done_resp.status_code == 200, done_resp.text

    progress = client.get(f"/api/v1/goals/{goal_id}/progress", headers=headers)
    assert progress.status_code == 200
    assert float(progress.json()["progress"]) == 50.0

    after = client.get(f"/api/v1/goal-folders/{folder['id']}", headers=headers)
    assert after.status_code == 200
    assert float(after.json()["progress"]) == 50.0
    assert after.json()["goal_count"] == 1
