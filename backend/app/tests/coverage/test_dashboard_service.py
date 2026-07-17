"""Phase 6 — dashboard service aggregates (currently unused by API routes)."""
import pytest

from app.models.activity import ActivityLog
from app.models.sprint import Sprint
from app.models.task import CustomStatus, TaskAssignee
from app.models.team import Team, TeamMember
from app.services import dashboard_service as ds
from app.services.permission_service import PermissionService
from app.tests.helpers import add_task, build_project_stack


@pytest.mark.coverage
def test_dashboard_trend_helpers():
    flat = ds._trend(0, unit="week")
    assert flat.direction == "flat" and flat.tone == "neutral"

    up = ds._trend(3, unit="week", positive_is_good=True)
    assert up.direction == "up" and up.tone == "positive"

    down = ds._trend(-2, unit="week", positive_is_good=True)
    assert down.direction == "down" and down.tone == "negative"

    pct = ds._pct_delta(60, 40)
    assert pct.direction == "up"


@pytest.mark.coverage
def test_build_org_dashboard_empty_for_non_workspace_admin(db, org, owner):
    from app.models.organization import OrganizationMember
    from app.tests.conftest import make_user

    member = make_user(db, "dash-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()

    result = ds.build_org_dashboard(db, PermissionService(db, member), org.id)
    assert result.organization_id == org.id
    assert result.kpis.active_projects == 0
    assert result.project_progress == []


@pytest.mark.coverage
def test_build_org_dashboard_with_project_data(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    add_task(db, project, owner, title="Dashboard task", number=1)
    db.flush()

    result = ds.build_org_dashboard(db, PermissionService(db, owner), org.id, days=7)
    assert result.organization_id == org.id
    assert result.kpis.active_projects >= 1
    assert result.kpis.organization_members >= 1
    assert result.project_progress_total >= 0
    assert isinstance(result.recent_activities, list)


@pytest.mark.coverage
def test_dashboard_helpers_critical_and_activity():
    from datetime import date, timedelta

    assert ds._critical_kind(
        type("T", (), {"due_date": date.today() - timedelta(days=1), "priority": "normal"})(),
        None,
        date.today(),
    ) == "overdue"
    assert ds._activity_summary("github.push", {"summary": "Pushed to main"}) == "Pushed to main"
    assert ds._activity_summary("task.created", {"title": "New task"}) == "New task"


@pytest.mark.coverage
def test_build_org_dashboard_team_workload_and_critical(db, org, owner):
    from datetime import date, datetime, timedelta, timezone

    workspace, project = build_project_stack(db, org, owner, project_key="DSH")
    team = Team(workspace_id=workspace.id, name="Platform", color="#3366ff", created_by=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id))
    cancelled = CustomStatus(
        project_id=project.id, name="Cancelled", color="#999", category="cancelled", position=0
    )
    db.add(cancelled)
    db.flush()

    today = date.today()
    for i in range(6):
        t = add_task(db, project, owner, title=f"Open {i}", number=i + 1)
        t.priority = "urgent" if i == 0 else "normal"
        t.due_date = today - timedelta(days=1) if i == 1 else (today if i == 2 else None)
        db.add(TaskAssignee(task_id=t.id, user_id=owner.id))
    blocked = add_task(db, project, owner, title="Blocked", number=10)
    blocked.status_id = cancelled.id
    db.flush()

    db.add(
        ActivityLog(
            workspace_id=workspace.id,
            project_id=project.id,
            actor_id=owner.id,
            action="task.created",
            data={"title": "Dashboard activity"},
        )
    )
    sprint = Sprint(
        workspace_id=workspace.id,
        project_id=project.id,
        name="Sprint 1",
        status="active",
        created_by=owner.id,
        started_at=datetime.now(timezone.utc),
    )
    db.add(sprint)
    db.flush()

    result = ds.build_org_dashboard(db, PermissionService(db, owner), org.id, days=14)
    assert result.team_workload_total >= 1
    platform = next(r for r in result.team_workload if r.name == "Platform")
    assert platform.member_count == 1
    assert platform.open_tasks == 6
    assert platform.overdue_tasks == 1
    assert result.team_productivity_total >= 1
    assert isinstance(result.team_productivity_trend, list)
    assert len(result.team_productivity_trend) == 7
    assert result.team_productivity_summary is not None
    assert len(result.delivery_velocity_trend) == 7
    assert result.delivery_velocity_summary is not None
    assert result.critical_tasks_total >= 1
    assert result.recent_activities
    assert result.recent_activities[0].summary == "Dashboard activity"
    assert result.project_portfolio
    assert any(p.active_sprint == "Sprint 1" for p in result.project_portfolio)


@pytest.mark.coverage
def test_team_productivity_workspace_rollup_for_large_team_counts(db, org, owner, monkeypatch):
    from datetime import date, datetime, timezone

    from app.models.workspace import Workspace, WorkspaceMember

    monkeypatch.setattr(ds, "TEAM_PRODUCTIVITY_WORKSPACE_ROLLUP_THRESHOLD", 2)

    ws1, project = build_project_stack(db, org, owner, project_name="Rollup")
    ws2 = Workspace(organization_id=org.id, name="Europe", created_by=owner.id)
    db.add(ws2)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws2.id, user_id=owner.id, role="admin"))

    teams: list[Team] = []
    for ws, name in [(ws1, "Alpha"), (ws1, "Beta"), (ws2, "Gamma")]:
        team = Team(workspace_id=ws.id, name=name, color="#3366ff", created_by=owner.id)
        db.add(team)
        db.flush()
        db.add(TeamMember(team_id=team.id, user_id=owner.id))
        teams.append(team)

    completed_at = datetime.now(timezone.utc)
    for i in range(3):
        task = add_task(db, project, owner, title=f"Done {i}", number=i + 1)
        task.completed_at = completed_at
        db.add(TaskAssignee(task_id=task.id, user_id=owner.id))
    db.flush()

    series, trend, summary = ds._build_team_productivity_chart(
        db, teams, [project.id], date.today()
    )

    assert summary.display_mode == "workspace"
    assert summary.total_teams == 3
    assert summary.total_entities == 2
    assert len(trend) == 7
    assert any(s.key.startswith("ws-") for s in series)
    assert summary.leading_team_name in {"WS", "Europe"}


@pytest.mark.coverage
def test_sprint_summaries_count_completed_tasks_in_sprint(db, org, owner):
    from datetime import datetime, timezone

    from app.models.sprint import SprintTask

    workspace, project = build_project_stack(db, org, owner)
    done = add_task(db, project, owner, title="Done", number=1)
    done.completed_at = datetime.now(timezone.utc)
    open_task = add_task(db, project, owner, title="Open", number=2)
    sprint = Sprint(
        workspace_id=workspace.id,
        project_id=project.id,
        name="Active sprint",
        status="active",
        created_by=owner.id,
        started_at=datetime.now(timezone.utc),
    )
    db.add(sprint)
    db.flush()
    db.add(SprintTask(sprint_id=sprint.id, task_id=done.id))
    db.add(SprintTask(sprint_id=sprint.id, task_id=open_task.id))
    db.flush()

    summaries = ds._sprint_summaries(db, workspace.id, [project.id])
    assert len(summaries) == 1
    row = summaries[0]
    assert row.task_count == 2
    assert row.completed_tasks == 1
    assert row.total_points == 0
    assert row.completed_points == 0
