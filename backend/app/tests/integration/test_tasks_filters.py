"""Integration — task filters, my_tasks, share GET, and checklist/custom-field deletes."""
from datetime import date, timedelta
from unittest.mock import patch

import pytest

from app.core.task_ref import format_task_ref
from app.models.task import CustomStatus, TaskAssignee
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack, seed_github_repo, seed_personal_github, seed_project_github


@pytest.mark.integration
def test_my_tasks_excludes_assigned_subtasks_from_top_level(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SUB")
    parent = add_task(db, project, owner, title="Parent task", number=1)
    subtask = add_task(db, project, owner, title="Child subtask", number=2)
    subtask.parent_task_id = parent.id
    db.add(TaskAssignee(task_id=parent.id, user_id=owner.id))
    db.add(TaskAssignee(task_id=subtask.id, user_id=owner.id))
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/me/tasks", headers=headers, params={"relation": "assigned"})
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == str(parent.id)
    assert items[0]["title"] == "Parent task"


@pytest.mark.integration
def test_my_tasks_includes_parent_when_only_subtask_is_assigned(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SBP")
    member = add_project_member(db, org, workspace, project, "sub-only@test.dev")
    parent = add_task(db, project, owner, title="Parent only", number=1)
    subtask = add_task(db, project, owner, title="Assigned sub", number=2)
    subtask.parent_task_id = parent.id
    db.add(TaskAssignee(task_id=subtask.id, user_id=member.id))
    db.flush()
    headers = auth_headers(client, member.email)

    response = client.get("/api/v1/me/tasks", headers=headers, params={"relation": "assigned"})
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == str(parent.id)


@pytest.mark.integration
def test_my_tasks_filters_by_relation_and_due(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="FLT")
    today = date.today()
    overdue = add_task(db, project, owner, title="Overdue", number=1)
    overdue.due_date = today - timedelta(days=2)
    week_task = add_task(db, project, owner, title="This week", number=2)
    week_task.due_date = today + timedelta(days=3)
    db.add(TaskAssignee(task_id=overdue.id, user_id=owner.id))
    db.flush()
    headers = auth_headers(client, owner.email)

    assigned = client.get("/api/v1/me/tasks", headers=headers, params={"relation": "assigned"})
    assert assigned.status_code == 200
    ids = {t["id"] for t in assigned.json()["items"]}
    assert str(overdue.id) in ids

    overdue_only = client.get("/api/v1/me/tasks", headers=headers, params={"due": "overdue"})
    assert all(t["id"] == str(overdue.id) for t in overdue_only.json()["items"])

    created = client.get("/api/v1/me/tasks", headers=headers, params={"relation": "created"})
    assert created.status_code == 200
    assert len(created.json()["items"]) >= 2


@pytest.mark.integration
def test_list_tasks_q_matches_task_ref(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="REF")
    task = add_task(db, project, owner, title="Unrelated title", number=7)
    add_task(db, project, owner, title="Other task", number=8)
    db.flush()
    headers = auth_headers(client, owner.email)
    task_ref = format_task_ref(project.id, task.number)

    by_full_ref = client.get(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        params={"q": task_ref},
    )
    assert by_full_ref.status_code == 200
    items = by_full_ref.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == str(task.id)

    by_ref_suffix = client.get(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        params={"q": f"-{task.number}"},
    )
    assert by_ref_suffix.status_code == 200
    assert any(t["id"] == str(task.id) for t in by_ref_suffix.json()["items"])


@pytest.mark.integration
def test_list_tasks_filters_priority_label_assignee(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="FIL")
    member = add_project_member(db, org, workspace, project, "filter-member@test.dev")
    urgent = add_task(db, project, owner, title="Urgent bug", number=1)
    urgent.priority = "urgent"
    urgent.labels = ["bug"]
    db.add(TaskAssignee(task_id=urgent.id, user_id=member.id))
    add_task(db, project, owner, title="Normal task", number=2)
    db.flush()
    headers = auth_headers(client, owner.email)

    filtered = client.get(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        params={"priority": "urgent", "label": "bug", "assignee_id": str(member.id), "q": "bug"},
    )
    assert filtered.status_code == 200
    items = filtered.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "Urgent bug"


@pytest.mark.integration
def test_member_cannot_change_assigned_task_status(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "status-lock@test.dev")
    other = add_project_member(db, org, workspace, project, "assignee-other@test.dev")
    status = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(status)
    db.flush()
    task = add_task(db, project, owner, title="Assigned to other", number=1)
    db.add(TaskAssignee(task_id=task.id, user_id=other.id))
    db.flush()
    headers = auth_headers(client, member.email)

    patch = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"status_id": str(status.id)},
    )
    assert patch.status_code == 403


@pytest.mark.integration
def test_get_task_share_state(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Share read", number=10)
    task.is_private = True
    db.flush()
    headers = auth_headers(client, owner.email)

    client.patch(
        f"/api/v1/tasks/{task.id}/share",
        headers=headers,
        json={"public_enabled": True, "public_searchable": True},
    )
    share = client.get(f"/api/v1/tasks/{task.id}/share", headers=headers)
    assert share.status_code == 200
    assert share.json()["public_enabled"] is True
    assert share.json()["public_url"]


@pytest.mark.integration
@patch("app.services.invite_service.create_invite")
def test_add_share_member_by_email_invites_outsider(mock_invite, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Invite share", number=11)
    task.is_private = True
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/tasks/{task.id}/share/members",
        headers=headers,
        json={"email": "outsider-new@test.dev"},
    )
    assert response.status_code == 201
    mock_invite.assert_called_once()


@pytest.mark.integration
@patch("app.services.github_api_service.add_issue_labels")
@patch("app.services.github_api_service.list_issue_labels", return_value=[])
@patch("app.services.github_api_service.ensure_label")
@patch("app.services.github_api_service.update_issue_state")
def test_update_task_status_done_closes_github_issue(
    mock_update, mock_ensure, mock_list, mock_add, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="GHI")
    proj_conn = seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    seed_github_repo(db, workspace, project, proj_conn)
    done = CustomStatus(project_id=project.id, name="Done", color="#0f0", category="done", position=0)
    db.add(done)
    db.flush()
    task = add_task(db, project, owner, title="Linked", number=5)
    task.github_issue_number = 42
    db.flush()
    headers = auth_headers(client, owner.email)

    patch = client.patch(
        f"/api/v1/tasks/{task.id}",
        headers=headers,
        json={"status_id": str(done.id)},
    )
    assert patch.status_code == 200
    # Issue is closed and tagged with the FlowDesk status label
    mock_update.assert_called_once()
    assert mock_update.call_args.args[-1] == "closed"
    assert mock_add.call_args.args[-1] == ["flowdesk: Done"]


@pytest.mark.integration
@patch("app.services.github_api_service.add_issue_labels")
@patch("app.services.github_api_service.list_issue_labels", return_value=["flowdesk: To Do"])
@patch("app.services.github_api_service.ensure_label")
@patch("app.services.github_api_service.update_issue_state")
def test_update_task_intermediate_status_keeps_issue_open_and_relabels(
    mock_update, mock_ensure, mock_list, mock_add, client, db, org, owner
):
    workspace, project = build_project_stack(db, org, owner, project_key="GHR")
    proj_conn = seed_project_github(db, org, project, owner)
    seed_personal_github(db, org, owner)
    seed_github_repo(db, workspace, project, proj_conn)
    in_review = CustomStatus(
        project_id=project.id, name="In Review", color="#fa0", category="in_progress", position=1
    )
    db.add(in_review)
    db.flush()
    task = add_task(db, project, owner, title="Linked", number=6)
    task.github_issue_number = 43
    db.flush()
    headers = auth_headers(client, owner.email)

    with patch("app.services.github_api_service.remove_issue_label") as mock_remove:
        resp = client.patch(
            f"/api/v1/tasks/{task.id}",
            headers=headers,
            json={"status_id": str(in_review.id)},
        )
        assert resp.status_code == 200
        # Intermediate status → issue stays OPEN, stale FlowDesk label replaced
        assert mock_update.call_args.args[-1] == "open"
        mock_remove.assert_called_once()
        assert mock_remove.call_args.args[-1] == "flowdesk: To Do"
        assert mock_add.call_args.args[-1] == ["flowdesk: In Review"]
