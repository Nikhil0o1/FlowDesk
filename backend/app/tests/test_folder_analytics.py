"""Phase 4 folder analytics tests."""

from app.tests.conftest import auth_headers
from app.tests.helpers import build_project_stack


def test_folder_analytics_counts_and_progress(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Analytics Folder"},
    ).json()
    folder_id = folder["id"]

    active = client.post(
        f"/api/v1/goal-folders/{folder_id}/goals",
        headers=headers,
        json={"name": "Active goal", "owner_id": str(owner.id)},
    )
    assert active.status_code == 201, active.text
    active_id = active.json()["id"]

    done_goal = client.post(
        f"/api/v1/goal-folders/{folder_id}/goals",
        headers=headers,
        json={"name": "Done goal", "owner_id": str(owner.id)},
    )
    assert done_goal.status_code == 201, done_goal.text
    done_id = done_goal.json()["id"]

    t1 = client.post(
        f"/api/v1/goals/{active_id}/targets",
        headers=headers,
        json={
            "title": "Half",
            "owner_id": str(owner.id),
            "target_type": "number",
            "start_value": 0,
            "target_value": 100,
            "current_value": 50,
        },
    )
    assert t1.status_code == 201, t1.text

    t2 = client.post(
        f"/api/v1/goals/{done_id}/targets",
        headers=headers,
        json={
            "title": "Full",
            "owner_id": str(owner.id),
            "target_type": "true_false",
            "is_completed": True,
        },
    )
    assert t2.status_code == 201, t2.text

    completed_goal = client.get(f"/api/v1/goals/{done_id}", headers=headers)
    assert float(completed_goal.json()["progress"]) == 100.0
    assert completed_goal.json()["status"] == "completed"

    archived = client.post(
        f"/api/v1/goal-folders/{folder_id}/goals",
        headers=headers,
        json={"name": "Old", "owner_id": str(owner.id)},
    )
    assert archived.status_code == 201
    assert (
        client.patch(
            f"/api/v1/goals/{archived.json()['id']}",
            headers=headers,
            json={"status": "archived"},
        ).status_code
        == 200
    )

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goal-folders", headers=headers)
    assert listed.status_code == 200
    row = next(f for f in listed.json() if f["id"] == folder_id)
    assert row["goal_count"] == 3
    assert row["active_count"] == 1
    assert row["completed_count"] == 1
    assert row["archived_count"] == 1
    # Progress excludes archived: (50 + 100) / 2 = 75
    assert float(row["progress"]) == 75.0

    analytics = client.get(f"/api/v1/goal-folders/{folder_id}/analytics", headers=headers)
    assert analytics.status_code == 200, analytics.text
    data = analytics.json()
    assert data["folder_id"] == folder_id
    assert data["goal_count"] == 3
    assert data["active_count"] == 1
    assert data["completed_count"] == 1
    assert data["archived_count"] == 1
    assert data["tracked_goal_count"] == 2
    assert data["in_progress_count"] == 1
    assert data["not_started_count"] == 0
    assert float(data["progress"]) == 75.0
