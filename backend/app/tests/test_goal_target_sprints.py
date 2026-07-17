"""Link sprints (lists) to goal targets — progress from sprint tasks."""

from app.models.sprint import Sprint, SprintTask
from app.models.task import CustomStatus, Task
from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


def test_link_sprint_to_target_updates_progress(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    done = CustomStatus(
        project_id=project.id,
        name="Done",
        category="done",
        color="#22c55e",
        position=1,
    )
    todo = CustomStatus(
        project_id=project.id,
        name="Todo",
        category="todo",
        color="#64748b",
        position=0,
    )
    db.add_all([done, todo])
    db.flush()

    t1 = add_task(db, project, owner, "Done task", 1)
    t1.status_id = done.id
    t2 = add_task(db, project, owner, "Open task", 2)
    t2.status_id = todo.id
    db.flush()

    sprint = Sprint(
        workspace_id=workspace.id,
        project_id=project.id,
        name="Sprint Alpha",
        status="active",
        created_by=owner.id,
    )
    db.add(sprint)
    db.flush()
    db.add_all(
        [
            SprintTask(sprint_id=sprint.id, task_id=t1.id, added_by=owner.id),
            SprintTask(sprint_id=sprint.id, task_id=t2.id, added_by=owner.id),
        ]
    )
    db.flush()

    goal = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Ship sprint", "owner_id": str(owner.id)},
    ).json()
    target = client.post(
        f"/api/v1/goals/{goal['id']}/targets",
        headers=headers,
        json={"title": "Sprint work", "target_type": "tasks", "owner_id": str(owner.id)},
    ).json()

    linked = client.post(
        f"/api/v1/targets/{target['id']}/sprints",
        headers=headers,
        json={"sprint_id": str(sprint.id)},
    )
    assert linked.status_code == 201, linked.text

    listed = client.get(f"/api/v1/targets/{target['id']}/sprints", headers=headers)
    assert listed.status_code == 200
    assert any(s["sprint_id"] == str(sprint.id) for s in listed.json())

    tasks = client.get(f"/api/v1/targets/{target['id']}/tasks", headers=headers)
    assert tasks.status_code == 200
    assert len(tasks.json()) == 2

    progress = client.get(f"/api/v1/goals/{goal['id']}/progress", headers=headers)
    assert progress.status_code == 200
    # 1 of 2 done → 50%
    assert float(progress.json()["progress"]) == 50.0

    # New task added to sprint should sync into the goal target
    t3 = add_task(db, project, owner, "Late add", 3)
    t3.status_id = todo.id
    db.flush()
    add_to_sprint = client.post(
        f"/api/v1/sprints/{sprint.id}/tasks",
        headers=headers,
        json={"task_ids": [str(t3.id)]},
    )
    assert add_to_sprint.status_code == 200, add_to_sprint.text

    tasks2 = client.get(f"/api/v1/targets/{target['id']}/tasks", headers=headers)
    assert len(tasks2.json()) == 3
    progress2 = client.get(f"/api/v1/goals/{goal['id']}/progress", headers=headers)
    # 1 of 3 done
    assert abs(float(progress2.json()["progress"]) - (100 / 3)) < 0.05
