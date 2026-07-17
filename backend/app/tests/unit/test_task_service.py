"""Phase 2 unit tests — task_service business rules."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.services import task_service
from app.tests.helpers import add_project_member, add_task, build_project_stack


@pytest.mark.unit
def test_claim_task_number_increments(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    project.next_task_number = 10
    db.flush()

    n1 = task_service.claim_task_number(db, project.id)
    n2 = task_service.claim_task_number(db, project.id)
    assert n1 == 10
    assert n2 == 11
    assert project.next_task_number == 12


@pytest.mark.unit
def test_validate_assignee_ids_rejects_outsider(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    outsider = add_project_member(db, org, workspace, project, "task-outsider@test.dev")
    import uuid

    with pytest.raises(HTTPException) as exc:
        task_service.validate_assignee_ids(db, project.id, [outsider.id, uuid.uuid4()])
    assert exc.value.status_code == 400


@pytest.mark.unit
def test_validate_task_list_allows_none(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task_service.validate_task_list(db, project.id, None)


@pytest.mark.unit
def test_validate_task_list_rejects_foreign_list(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    other_workspace, other_project = build_project_stack(db, org, owner, project_key="OTH")
    from app.models.project import TaskList
    foreign = TaskList(project_id=other_project.id, name="Other", position=1)
    db.add(foreign)
    db.flush()
    with pytest.raises(HTTPException) as exc:
        task_service.validate_task_list(db, project.id, foreign.id)
    assert exc.value.status_code == 400


@pytest.mark.unit
def test_validate_assignee_ids_allows_empty_list(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task_service.validate_assignee_ids(db, project.id, [])


@pytest.mark.unit
def test_validate_assignee_ids_accepts_project_members(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "task-member@test.dev")
    task_service.validate_assignee_ids(db, project.id, [member.id])


@pytest.mark.unit
def test_task_url_uses_frontend_base(monkeypatch):
    monkeypatch.setattr("app.services.task_service.settings.FRONTEND_URL", "https://app.test")
    import uuid

    tid = uuid.uuid4()
    assert task_service.task_url(tid) == f"https://app.test/app/tasks/{tid}"


@pytest.mark.unit
def test_validate_task_schedule_dates_allows_past_values():
    today = date.today()
    past = today - timedelta(days=5)
    task_service.validate_task_schedule_dates(due_date=past, today=today)
    task_service.validate_task_schedule_dates(start_date=past, today=today)


@pytest.mark.unit
def test_validate_task_schedule_dates_allows_unchanged_legacy_dates():
    today = date.today()
    past = today - timedelta(days=5)
    task_service.validate_task_schedule_dates(
        due_date=past,
        existing_due=past,
        today=today,
    )
    task_service.validate_task_schedule_dates(
        start_date=past,
        existing_start=past,
        today=today,
    )


@pytest.mark.unit
def test_validate_task_schedule_dates_rejects_due_before_start():
    today = date.today()
    with pytest.raises(HTTPException) as exc:
        task_service.validate_task_schedule_dates(
            start_date=today + timedelta(days=5),
            due_date=today + timedelta(days=2),
            today=today,
        )
    assert exc.value.status_code == 422


@pytest.mark.unit
def test_apply_status_change_noop_when_unchanged(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Status task", number=3)
    assert task_service.apply_status_change(db, task, task.status_id) is False


@pytest.mark.unit
def test_rollup_parent_task_status_uses_least_advanced_subtask(db, org, owner):
    from app.models.task import CustomStatus

    workspace, project = build_project_stack(db, org, owner)
    todo = CustomStatus(project_id=project.id, name="To Do", category="todo", position=0)
    in_progress = CustomStatus(project_id=project.id, name="In Progress", category="in_progress", position=1)
    in_review = CustomStatus(project_id=project.id, name="In Review", category="in_progress", position=2)
    complete = CustomStatus(project_id=project.id, name="Complete", category="done", position=3)
    db.add_all([todo, in_progress, in_review, complete])
    db.flush()

    parent = add_task(db, project, owner, title="Parent", number=10)
    parent.status_id = complete.id
    parent.completed_at = task_service._now()
    sub_b = add_task(db, project, owner, title="B", number=11)
    sub_b.parent_task_id = parent.id
    sub_b.status_id = in_progress.id
    sub_c = add_task(db, project, owner, title="C", number=12)
    sub_c.parent_task_id = parent.id
    sub_c.status_id = in_review.id
    sub_d = add_task(db, project, owner, title="D", number=13)
    sub_d.parent_task_id = parent.id
    sub_d.status_id = complete.id
    db.flush()

    assert task_service.rollup_parent_task_status(db, parent.id) is True
    db.refresh(parent)
    assert parent.status_id == in_progress.id
    assert parent.completed_at is None

    sub_b.status_id = in_review.id
    db.flush()
    assert task_service.rollup_parent_task_status(db, parent.id) is True
    db.refresh(parent)
    assert parent.status_id == in_review.id


@pytest.mark.unit
def test_assert_parent_may_complete_blocks_open_subtasks(db, org, owner):
    from app.models.task import CustomStatus

    workspace, project = build_project_stack(db, org, owner)
    complete = CustomStatus(project_id=project.id, name="Complete", category="done", position=3)
    db.add(complete)
    db.flush()
    parent = add_task(db, project, owner, title="Parent", number=20)
    child = add_task(db, project, owner, title="Child", number=21)
    child.parent_task_id = parent.id
    db.flush()

    with pytest.raises(HTTPException) as exc:
        task_service.assert_parent_may_complete(db, parent, complete.id)
    assert exc.value.status_code == 422

    task_service.assert_parent_may_complete(db, parent, complete.id, force_complete_subtasks=True)


@pytest.mark.unit
def test_assign_users_skips_existing_and_inactive(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "active-member@test.dev")
    inactive = add_project_member(db, org, workspace, project, "inactive-member@test.dev")
    inactive.is_active = False
    task = add_task(db, project, owner, title="Assign task", number=4)
    from app.models.task import TaskAssignee

    db.add(TaskAssignee(task_id=task.id, user_id=member.id, assigned_by=owner.id))
    db.flush()

    added = task_service.assign_users(
        db,
        task,
        project,
        [member.id, inactive.id],
        owner,
        notify_users=False,
    )
    assert added == []
