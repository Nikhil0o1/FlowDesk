"""Phase 1 goal folder CRUD tests."""

from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


def test_goal_folder_crud(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={
            "name": "Engineering",
            "description": "Eng OKRs",
            "color": "#3b82f6",
        },
    )
    assert created.status_code == 201, created.text
    folder = created.json()
    assert folder["name"] == "Engineering"
    assert folder["description"] == "Eng OKRs"
    assert folder["color"] == "#3b82f6"
    assert folder["goal_count"] == 0
    folder_id = folder["id"]

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/goal-folders", headers=headers)
    assert listed.status_code == 200
    assert any(f["id"] == folder_id for f in listed.json())

    detail = client.get(f"/api/v1/goal-folders/{folder_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["name"] == "Engineering"
    assert detail.json()["goals"] == []

    updated = client.patch(
        f"/api/v1/goal-folders/{folder_id}",
        headers=headers,
        json={"name": "Eng 2026", "color": "#22c55e"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Eng 2026"
    assert updated.json()["color"] == "#22c55e"

    goal = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=headers,
        json={"name": "Ship API", "owner_id": str(owner.id), "folder_id": folder_id},
    )
    assert goal.status_code == 201, goal.text
    assert goal.json()["folder_id"] == folder_id

    detail2 = client.get(f"/api/v1/goal-folders/{folder_id}", headers=headers)
    assert detail2.status_code == 200
    assert detail2.json()["goal_count"] == 1
    assert len(detail2.json()["goals"]) == 1
    assert float(detail2.json()["progress"]) == 0.0

    deleted = client.delete(f"/api/v1/goal-folders/{folder_id}", headers=headers)
    assert deleted.status_code == 200

    assert client.get(f"/api/v1/goal-folders/{folder_id}", headers=headers).status_code == 404
    restored_goal = client.get(f"/api/v1/goals/{goal.json()['id']}", headers=headers)
    assert restored_goal.status_code == 200
    assert restored_goal.json()["folder_id"] is None


def test_member_cannot_create_goal_folder(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    add_project_member(db, org, workspace, project, "folder-member@test.dev", role="member")
    headers = auth_headers(client, "folder-member@test.dev")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Blocked"},
    )
    assert response.status_code == 403


def test_create_list_and_move_goals_in_folders(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, "owner@test.dev")

    folder_a = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Alpha", "color": "#3b82f6"},
    ).json()
    folder_b = client.post(
        f"/api/v1/workspaces/{workspace.id}/goal-folders",
        headers=headers,
        json={"name": "Beta", "color": "#22c55e"},
    ).json()

    created = client.post(
        f"/api/v1/goal-folders/{folder_a['id']}/goals",
        headers=headers,
        json={"name": "Goal in Alpha", "owner_id": str(owner.id)},
    )
    assert created.status_code == 201, created.text
    assert created.json()["folder_id"] == folder_a["id"]
    goal_id = created.json()["id"]

    listed = client.get(f"/api/v1/goal-folders/{folder_a['id']}/goals", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["id"] == goal_id

    counts = {
        f["id"]: f["goal_count"]
        for f in client.get(f"/api/v1/workspaces/{workspace.id}/goal-folders", headers=headers).json()
    }
    assert counts[folder_a["id"]] == 1
    assert counts[folder_b["id"]] == 0

    moved = client.post(
        f"/api/v1/goals/{goal_id}/move",
        headers=headers,
        json={"folder_id": folder_b["id"]},
    )
    assert moved.status_code == 200
    assert moved.json()["folder_id"] == folder_b["id"]

    assert client.get(f"/api/v1/goal-folders/{folder_a['id']}/goals", headers=headers).json() == []
    assert len(client.get(f"/api/v1/goal-folders/{folder_b['id']}/goals", headers=headers).json()) == 1

    counts2 = {
        f["id"]: f["goal_count"]
        for f in client.get(f"/api/v1/workspaces/{workspace.id}/goal-folders", headers=headers).json()
    }
    assert counts2[folder_a["id"]] == 0
    assert counts2[folder_b["id"]] == 1

    unfiled = client.post(f"/api/v1/goals/{goal_id}/move", headers=headers, json={"folder_id": None})
    assert unfiled.status_code == 200
    assert unfiled.json()["folder_id"] is None
