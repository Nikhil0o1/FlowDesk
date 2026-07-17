"""My Analytics Phase 1 — personal, JWT-scoped endpoints."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.task import TaskAssignee
from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack

pytestmark = pytest.mark.integration


def _assign_and_complete(db, project, user, title, number, *, due=None, completed_day=None):
    task = add_task(db, project, user, title=title, number=number)
    if due:
        task.due_date = due
    db.add(TaskAssignee(task_id=task.id, user_id=user.id))
    completed = completed_day or datetime.now(timezone.utc)
    task.completed_at = completed
    db.flush()
    return task


def test_my_analytics_overview_counts_completed(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYA")
    today = date.today()
    _assign_and_complete(
        db,
        project,
        owner,
        "Done task",
        1,
        due=today,
        completed_day=datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc),
    )
    open_task = add_task(db, project, owner, title="Open task", number=2)
    db.add(TaskAssignee(task_id=open_task.id, user_id=owner.id))
    db.flush()

    res = client.get("/api/v1/my-analytics/overview", headers=auth_headers(client, owner.email))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["overview"]["tasks_completed"] >= 1
    assert body["overview"]["completion_rate"] >= 50
    assert body["monthly_summary"]["completed_tasks"] >= 1


def test_my_analytics_productivity_trend(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYP")
    today = datetime.now(timezone.utc)
    _assign_and_complete(db, project, owner, "Trend task", 1, completed_day=today)

    res = client.get(
        "/api/v1/my-analytics/productivity-trend?period=week",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["period"] == "week"
    assert len(body["points"]) == 7
    assert body["total"] >= 1


def test_my_analytics_task_trends_weekdays(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYT")
    _assign_and_complete(db, project, owner, "Week task", 1)

    res = client.get(
        "/api/v1/my-analytics/task-trends",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["points"]) == 7
    assert [p["weekday"] for p in body["points"]] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    assert body["total"] >= 1
    assert "week_start" in body
    assert "date" in body["points"][0]

def test_my_analytics_deadline_performance(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYD")
    today = date.today()
    _assign_and_complete(
        db,
        project,
        owner,
        "On time",
        1,
        due=today,
        completed_day=datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc),
    )
    late_day = today - timedelta(days=3)
    _assign_and_complete(
        db,
        project,
        owner,
        "Late",
        2,
        due=late_day,
        completed_day=datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc),
    )

    res = client.get(
        "/api/v1/my-analytics/deadline-performance?days=90",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] >= 2
    labels = {s["label"] for s in body["slices"]}
    assert "late" in labels


def test_my_analytics_deadline_is_user_scoped(client, db, org, owner):
    """Each user must only see their own deadline buckets — never a peer's."""
    from app.models.organization import OrganizationMember
    from app.models.workspace import WorkspaceMember
    from app.tests.conftest import make_user

    workspace, project = build_project_stack(db, org, owner, project_key="MYISO")
    peer = make_user(db, email="peer-analytics@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=peer.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=peer.id, role="member"))
    db.flush()

    today = date.today()
    _assign_and_complete(
        db,
        project,
        owner,
        "Owner on time",
        1,
        due=today,
        completed_day=datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc),
    )
    late_day = today - timedelta(days=5)
    _assign_and_complete(
        db,
        project,
        peer,
        "Peer late",
        2,
        due=late_day,
        completed_day=datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc),
    )

    owner_res = client.get(
        "/api/v1/my-analytics/deadline-performance?days=90",
        headers=auth_headers(client, owner.email),
    )
    assert owner_res.status_code == 200, owner_res.text
    owner_body = owner_res.json()
    owner_by_label = {s["label"]: s["count"] for s in owner_body["slices"]}
    assert owner_body["total"] == 1
    assert owner_by_label.get("late", 0) == 0
    assert owner_by_label.get("on_time", 0) + owner_by_label.get("early", 0) == 1

    peer_res = client.get(
        "/api/v1/my-analytics/deadline-performance?days=90",
        headers=auth_headers(client, peer.email),
    )
    assert peer_res.status_code == 200, peer_res.text
    peer_body = peer_res.json()
    peer_by_label = {s["label"]: s["count"] for s in peer_body["slices"]}
    assert peer_body["total"] == 1
    assert peer_by_label.get("late", 0) == 1


def test_my_analytics_activity_feed(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYACT")
    _assign_and_complete(db, project, owner, "Activity task", 1)

    res = client.get(
        "/api/v1/my-analytics/activity?limit=20",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert len(items) >= 1
    assert any(i["type"] == "task_completed" for i in items)


def test_my_analytics_requires_auth(client):
    res = client.get("/api/v1/my-analytics/overview")
    assert res.status_code == 401


def test_my_analytics_work_pattern(client, db, org, owner):
    from sqlalchemy import select

    from app.models.presence import UserSession
    from app.models.user import Profile

    workspace, project = build_project_stack(db, org, owner, project_key="MYWP")
    _assign_and_complete(db, project, owner, "Pattern task", 1)

    # Same calendar day: early first login, mid-day restart, late logout.
    # Avg must use first login (09:00 IST) and last logout (18:00 IST).
    profile = db.scalar(select(Profile).where(Profile.user_id == owner.id))
    assert profile is not None
    profile.timezone = "Asia/Kolkata"
    day = datetime(2026, 7, 10, tzinfo=timezone.utc)
    db.add(
        UserSession(
            user_id=owner.id,
            login_time=day.replace(hour=3, minute=30),  # 09:00 IST
            logout_time=day.replace(hour=5, minute=0),  # 10:30 IST
            last_activity=day.replace(hour=5, minute=0),
        )
    )
    db.add(
        UserSession(
            user_id=owner.id,
            login_time=day.replace(hour=7, minute=0),  # 12:30 IST mid-day restart
            logout_time=day.replace(hour=12, minute=30),  # 18:00 IST
            last_activity=day.replace(hour=12, minute=30),
        )
    )
    db.flush()

    res = client.get(
        "/api/v1/my-analytics/work-pattern?days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["days"] == 30
    assert body["most_productive_day"] is not None
    assert body["timezone"] in ("Asia/Kolkata", "IST")
    assert body["avg_login_time"] == "09:00"
    assert body["avg_logout_time"] == "18:00"


def test_my_analytics_work_pattern_ignores_short_reconnect(client, db, org, owner):
    """A 2-minute reconnect must not drag typical start/end toward that blip."""
    from sqlalchemy import select

    from app.models.presence import UserSession
    from app.models.user import Profile

    build_project_stack(db, org, owner, project_key="MYWP2")
    profile = db.scalar(select(Profile).where(Profile.user_id == owner.id))
    assert profile is not None
    profile.timezone = "Asia/Kolkata"

    work = datetime(2026, 7, 11, tzinfo=timezone.utc)
    # Real workday 10:00–19:00 IST (04:30–13:30 UTC)
    db.add(
        UserSession(
            user_id=owner.id,
            login_time=work.replace(hour=4, minute=30),
            logout_time=work.replace(hour=8, minute=0),
            last_activity=work.replace(hour=8, minute=0),
        )
    )
    db.add(
        UserSession(
            user_id=owner.id,
            login_time=work.replace(hour=8, minute=30),
            logout_time=work.replace(hour=13, minute=30),
            last_activity=work.replace(hour=13, minute=30),
        )
    )
    # Noise-only day: 2-minute reconnect around noon — must be ignored.
    blip = datetime(2026, 7, 12, tzinfo=timezone.utc)
    db.add(
        UserSession(
            user_id=owner.id,
            login_time=blip.replace(hour=6, minute=30),
            logout_time=blip.replace(hour=6, minute=32),
            last_activity=blip.replace(hour=6, minute=32),
        )
    )
    db.flush()

    res = client.get(
        "/api/v1/my-analytics/work-pattern?days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["avg_login_time"] == "10:00"
    assert body["avg_logout_time"] == "19:00"


def test_my_analytics_time_distribution_by_project(client, db, org, owner):
    from app.models.task import TaskAssignee
    from app.models.time_entry import TimeEntry
    from app.tests.helpers import add_task

    workspace, project = build_project_stack(db, org, owner, project_key="MYTD")
    task = add_task(db, project, owner, title="Timed task", number=1)
    db.add(TaskAssignee(task_id=task.id, user_id=owner.id))
    started = datetime.now(timezone.utc) - timedelta(minutes=10)
    ended = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.add(
        TimeEntry(
            task_id=task.id,
            user_id=owner.id,
            started_at=started,
            ended_at=ended,
            duration_seconds=300,
        )
    )
    db.flush()

    res = client.get(
        "/api/v1/my-analytics/time-distribution?days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_seconds"] >= 300
    assert len(body["slices"]) >= 1
    assert body["slices"][0]["label"] == project.name
    assert body["slices"][0]["project_id"] == str(project.id)
    assert body["slices"][0]["percentage"] == 100
    # Must not return fake activity categories.
    labels = {s["label"].lower() for s in body["slices"]}
    assert "meetings" not in labels
    assert "documentation" not in labels


def test_my_analytics_project_contribution(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYPC")
    _assign_and_complete(db, project, owner, "Project task", 1)

    res = client.get(
        "/api/v1/my-analytics/project-contribution?days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_completed"] >= 1
    assert len(body["projects"]) >= 1


def test_my_analytics_priority_analysis(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYPRI")
    task = _assign_and_complete(db, project, owner, "Urgent task", 1)
    task.priority = "urgent"
    db.flush()

    res = client.get(
        "/api/v1/my-analytics/priority-analysis?days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] >= 1
    assert any(s["priority"] == "critical" for s in body["slices"])


def test_my_analytics_benchmarks(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="MYBM")
    _assign_and_complete(db, project, owner, "Benchmark task", 1)

    res = client.get(
        "/api/v1/my-analytics/benchmarks?period=week",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["period"] == "week"
    assert len(body["metrics"]) == 3
