"""Analytics module (Phase 1) + presence flow."""
import pytest
from sqlalchemy import select

from app.models.organization import OrganizationMember
from app.models.presence import PresenceEvent, UserPresence, UserSession
from app.tests.conftest import auth_headers, make_user

pytestmark = pytest.mark.integration


def _add_member(db, org, email, role="member"):
    user = make_user(db, email)
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=role))
    db.flush()
    return user


def test_heartbeat_creates_session_and_presence(client, db, org, owner):
    member = _add_member(db, org, "hb-member@test.dev")
    headers = auth_headers(client, member.email)

    res = client.post("/api/v1/presence/heartbeat", json={}, headers=headers)
    assert res.status_code == 200, res.text

    presence = db.query(UserPresence).filter(UserPresence.user_id == member.id).one()
    assert presence.status == "online"
    assert presence.last_seen is not None

    session = (
        db.query(UserSession)
        .filter(UserSession.user_id == member.id, UserSession.logout_time.is_(None))
        .one()
    )
    assert session.login_time is not None

    events = db.query(PresenceEvent).filter(PresenceEvent.user_id == member.id).all()
    assert any(e.event_type == "login" for e in events)


def test_overview_counts_online_member(client, db, org, owner):
    member = _add_member(db, org, "ov-member@test.dev")
    client.post(
        "/api/v1/presence/heartbeat", json={}, headers=auth_headers(client, member.email)
    )

    res = client.get(
        f"/api/v1/analytics/overview?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    # owner + member are both org members
    assert body["total_members"] >= 2
    assert body["online"] >= 1
    assert body["active_users_today"] >= 1
    assert body["online"] + body["offline"] + body["busy"] + body["away"] == body["total_members"]


def test_status_distribution_matches_total(client, db, org, owner):
    _add_member(db, org, "sd-member@test.dev")
    res = client.get(
        f"/api/v1/analytics/status-distribution?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert sum(s["count"] for s in body["slices"]) == body["total"]


def test_users_table_lists_member_with_device(client, db, org, owner):
    member = _add_member(db, org, "ut-member@test.dev")
    client.post(
        "/api/v1/presence/heartbeat",
        json={},
        headers={**auth_headers(client, member.email), "User-Agent": "Mozilla/5.0 Chrome/120"},
    )
    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    row = next(r for r in body["items"] if r["user"]["id"] == str(member.id))
    assert row["status"] == "online"
    assert row["browser"] == "Chrome"
    assert row["device"] == "Desktop"


def test_status_change_logged_and_feed(client, db, org, owner):
    member = _add_member(db, org, "sc-member@test.dev")
    hb = auth_headers(client, member.email)
    client.post("/api/v1/presence/heartbeat", json={}, headers=hb)
    res = client.post("/api/v1/presence/status", json={"status": "busy"}, headers=hb)
    assert res.status_code == 200, res.text

    presence = db.query(UserPresence).filter(UserPresence.user_id == member.id).one()
    assert presence.status == "busy"

    feed = client.get(
        f"/api/v1/analytics/activity-feed?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert feed.status_code == 200, feed.text
    assert len(feed.json()) >= 1


def test_busy_not_overridden_by_away_heartbeat(client, db, org, owner):
    member = _add_member(db, org, "busy-hb-member@test.dev")
    hb = auth_headers(client, member.email)
    client.post("/api/v1/presence/heartbeat", json={}, headers=hb)
    client.post("/api/v1/presence/status", json={"status": "busy"}, headers=hb)
    client.post("/api/v1/presence/heartbeat", json={"status": "away"}, headers=hb)

    presence = db.query(UserPresence).filter(UserPresence.user_id == member.id).one()
    assert presence.status == "busy"

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    row = next(r for r in res.json()["items"] if r["user"]["id"] == str(member.id))
    assert row["status"] == "busy"


def test_timeline_returns_24_buckets(client, db, org, owner):
    res = client.get(
        f"/api/v1/analytics/timeline?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["points"]) == 24


def test_logout_marks_offline(client, db, org, owner):
    member = _add_member(db, org, "lo-member@test.dev")
    hb = auth_headers(client, member.email)
    client.post("/api/v1/presence/heartbeat", json={}, headers=hb)
    res = client.post("/api/v1/presence/logout", headers=hb)
    assert res.status_code == 200, res.text

    presence = db.query(UserPresence).filter(UserPresence.user_id == member.id).one()
    assert presence.status == "offline"
    session = db.query(UserSession).filter(UserSession.user_id == member.id).one()
    assert session.logout_time is not None
    assert session.session_duration is not None


def test_plain_member_denied(client, db, org, owner):
    member = _add_member(db, org, "denied-member@test.dev")
    res = client.get(
        f"/api/v1/analytics/overview?organization_id={org.id}",
        headers=auth_headers(client, member.email),
    )
    assert res.status_code == 403


def test_personal_list_admin_denied_analytics(client, db, org, owner):
    """Personal List project-admin must not unlock org Analytics."""
    from app.models.workspace import WorkspaceMember
    from app.services.personal_list_service import get_or_create_personal_project
    from app.tests.helpers import add_project_member, build_project_stack

    workspace, project = build_project_stack(db, org, owner)
    member = make_user(db, "personal-only-analytics@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    personal = get_or_create_personal_project(db, workspace_id=workspace.id, user_id=member.id)
    assert personal.is_personal is True

    member_headers = auth_headers(client, "personal-only-analytics@test.dev")
    denied = client.get(
        f"/api/v1/analytics/overview?organization_id={org.id}",
        headers=member_headers,
    )
    assert denied.status_code == 403

    # Real non-personal project admin still has Analytics access.
    add_project_member(db, org, workspace, project, "real-pa-analytics@test.dev", role="admin")
    allowed = client.get(
        f"/api/v1/analytics/overview?organization_id={org.id}",
        headers=auth_headers(client, "real-pa-analytics@test.dev"),
    )
    assert allowed.status_code == 200, allowed.text


def test_user_detail_returns_session_and_timeline(client, db, org, owner):
    member = _add_member(db, org, "detail-member@test.dev")
    hb = auth_headers(client, member.email)
    client.post("/api/v1/presence/heartbeat", json={}, headers=hb)
    client.post("/api/v1/presence/status", json={"status": "busy"}, headers=hb)

    res = client.get(
        f"/api/v1/analytics/users/{member.id}?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["row"]["user"]["id"] == str(member.id)
    assert body["current_session"] is not None
    assert body["current_session"]["active"] is True
    assert len(body["weekly_activity"]) == 7
    assert len(body["status_timeline"]) >= 1


def test_user_detail_out_of_scope(client, db, org, owner):
    member = _add_member(db, org, "scoped-member@test.dev")
    # A workspace-less plain member of another org would be out of scope; here we
    # assert a random uuid (never a member) yields 403.
    import uuid as _uuid

    res = client.get(
        f"/api/v1/analytics/users/{_uuid.uuid4()}?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 403
    _ = member


def test_team_activity_groupings(client, db, org, owner):
    from app.models.workspace import Workspace, WorkspaceMember

    ws = Workspace(organization_id=org.id, name="Analytics WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    member = _add_member(db, org, "ta-member@test.dev")
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))
    db.flush()
    client.post(
        "/api/v1/presence/heartbeat", json={}, headers=auth_headers(client, member.email)
    )

    res = client.get(
        f"/api/v1/analytics/team-activity?organization_id={org.id}&group_by=workspace",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["group_by"] == "workspace"
    row = next(r for r in body["rows"] if r["id"] == str(ws.id))
    assert row["member_count"] == 2
    assert row["online"] >= 1


def test_team_activity_excludes_personal_projects(client, db, org, owner):
    from app.models.project import Project, ProjectMember, Space
    from app.models.workspace import Workspace, WorkspaceMember

    ws = Workspace(organization_id=org.id, name="TA Project WS", created_by=owner.id)
    db.add(ws)
    db.flush()
    space = Space(workspace_id=ws.id, name="General", color="#4F8BFF", position=0)
    db.add(space)
    db.flush()
    member = _add_member(db, org, "ta-personal@test.dev")
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role="admin"))

    real = Project(
        workspace_id=ws.id,
        space_id=space.id,
        name="Real Team Project",
        color="#8C5BFF",
        is_personal=False,
    )
    personal = Project(
        workspace_id=ws.id,
        space_id=None,
        name="Personal List",
        color="#7B68EE",
        is_personal=True,
        personal_owner_id=member.id,
    )
    db.add_all([real, personal])
    db.flush()
    db.add(ProjectMember(project_id=real.id, user_id=member.id, role="member"))
    db.add(ProjectMember(project_id=personal.id, user_id=member.id, role="admin"))
    db.flush()

    res = client.get(
        f"/api/v1/analytics/team-activity?organization_id={org.id}&group_by=project",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    names = {row["name"] for row in res.json()["rows"]}
    assert "Real Team Project" in names
    assert "Personal List" not in names


def test_timeline_ignores_stale_open_sessions(client, db, org, owner):
    """Abandoned tabs leave logout_time NULL — they must not count as online until now."""
    from datetime import datetime, timezone

    from app.models.user import Profile

    profile = db.scalar(select(Profile).where(Profile.user_id == owner.id))
    assert profile is not None
    profile.timezone = "UTC"
    db.flush()

    member = _add_member(db, org, "stale-tl@test.dev")
    # Open session midday on 2026-06-01, last activity at noon — never logged out.
    login = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
    last_activity = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    db.add(
        UserSession(
            user_id=member.id,
            login_time=login,
            logout_time=None,
            last_activity=last_activity,
            device="Desktop",
            browser="Chrome",
        )
    )
    db.flush()

    res = client.get(
        f"/api/v1/analytics/timeline?organization_id={org.id}&date=2026-06-01",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    online_by_hour = [p["online"] for p in res.json()["points"]]
    assert len(online_by_hour) == 24
    # Present through the 11:00 hour (span ends at 12:00); not stretched past last activity.
    assert online_by_hour[8] == 1
    assert online_by_hour[11] == 1
    assert online_by_hour[12] == 0
    assert online_by_hour[18] == 0
    assert max(online_by_hour[12:]) == 0


def test_role_filter(client, db, org, owner):
    _add_member(db, org, "role-member@test.dev", role="member")
    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}&role=owner",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert all(r["role"] == "owner" for r in body["items"])
    assert any(r["user"]["id"] == str(owner.id) for r in body["items"])


# --------------------------------------------------------------------------
# Phase 3: historical trends, heatmap, device analytics, alerts
# --------------------------------------------------------------------------


def _add_session(db, user, login, logout=None, device="Desktop", browser="Chrome"):
    duration = int((logout - login).total_seconds()) if logout else None
    session = UserSession(
        user_id=user.id,
        login_time=login,
        logout_time=logout,
        session_duration=duration,
        device=device,
        browser=browser,
    )
    db.add(session)
    db.flush()
    return session


def test_trends_returns_daily_points(client, db, org, owner):
    from datetime import datetime, timedelta, timezone

    member = _add_member(db, org, "trend-member@test.dev")
    now = datetime.now(timezone.utc)
    yesterday = now - timedelta(days=1)
    _add_session(
        db,
        member,
        login=yesterday.replace(hour=9, minute=0, second=0, microsecond=0),
        logout=yesterday.replace(hour=11, minute=0, second=0, microsecond=0),
    )

    res = client.get(
        f"/api/v1/analytics/trends?organization_id={org.id}&days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["days"] == 30
    assert len(body["points"]) == 30
    total_sessions = sum(p["total_sessions"] for p in body["points"])
    assert total_sessions >= 1
    assert body["peak_online"] >= 1


def test_heatmap_buckets_by_weekday_hour(client, db, org, owner):
    from datetime import datetime, timedelta, timezone

    member = _add_member(db, org, "heat-member@test.dev")
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    _add_session(db, member, login=start, logout=start + timedelta(hours=1))

    res = client.get(
        f"/api/v1/analytics/heatmap?organization_id={org.id}&days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["max_value"] >= 1
    cell = next(c for c in body["cells"] if c["weekday"] == start.weekday() and c["hour"] == 10)
    assert cell["value"] >= 1


def test_contribution_heatmap_daily_points(client, db, org, owner):
    from datetime import datetime, timedelta, timezone

    member = _add_member(db, org, "contrib-member@test.dev")
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    _add_session(db, member, login=start, logout=start + timedelta(hours=1))

    res = client.get(
        f"/api/v1/analytics/contribution-heatmap?organization_id={org.id}&days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["days"] == 30
    assert len(body["points"]) == 30
    assert body["max_count"] >= 1
    assert any(p["count"] >= 1 for p in body["points"])


def test_device_analytics_groups_devices(client, db, org, owner):
    from datetime import datetime, timedelta, timezone

    member = _add_member(db, org, "dev-member@test.dev")
    now = datetime.now(timezone.utc)
    base = (now - timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    _add_session(db, member, login=base, logout=base + timedelta(hours=1), device="Desktop", browser="Chrome")
    _add_session(
        db,
        member,
        login=base + timedelta(hours=2),
        logout=base + timedelta(hours=3),
        device="Mobile",
        browser="Safari",
    )

    res = client.get(
        f"/api/v1/analytics/devices?organization_id={org.id}&days=30",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_sessions"] >= 2
    names = {d["name"] for d in body["devices"]}
    assert {"Desktop", "Mobile"}.issubset(names)


def test_alerts_reports_no_one_online(client, db, org, owner):
    # No heartbeats at all → everyone offline → "no one online" alert.
    _add_member(db, org, "alert-member@test.dev")
    res = client.get(
        f"/api/v1/analytics/alerts?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    ids = {a["id"] for a in body["alerts"]}
    assert "no_one_online" in ids or "all_clear" in ids


def test_analytics_phase3_requires_access(client, db, org, owner):
    member = _add_member(db, org, "noaccess-member@test.dev")
    res = client.get(
        f"/api/v1/analytics/trends?organization_id={org.id}",
        headers=auth_headers(client, member.email),
    )
    assert res.status_code == 403


def test_org_admin_sees_owner_in_analytics_users(client, db, org, owner):
    org_admin = _add_member(db, org, "org-admin@test.dev", role="admin")
    member = _add_member(db, org, "org-admin-view-member@test.dev", role="member")

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, org_admin.email),
    )
    assert res.status_code == 200, res.text
    ids = {row["user"]["id"] for row in res.json()["items"]}
    assert str(owner.id) in ids
    assert str(org_admin.id) in ids
    assert str(member.id) in ids


def test_org_owner_sees_all_members_in_analytics_users(client, db, org, owner):
    org_admin = _add_member(db, org, "owner-view-admin@test.dev", role="admin")
    member = _add_member(db, org, "owner-view-member@test.dev", role="member")

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    ids = {row["user"]["id"] for row in res.json()["items"]}
    assert str(owner.id) in ids
    assert str(org_admin.id) in ids
    assert str(member.id) in ids


def test_workspace_admin_cannot_see_org_admin_in_analytics(client, db, org, owner):
    from app.models.workspace import Workspace, WorkspaceMember

    org_admin = _add_member(db, org, "ws-hide-org-admin@test.dev", role="admin")
    ws_admin = _add_member(db, org, "ws-admin@test.dev", role="member")
    workspace = Workspace(organization_id=org.id, name="Analytics WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=org_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="admin"))
    db.flush()

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, ws_admin.email),
    )
    assert res.status_code == 200, res.text
    ids = {row["user"]["id"] for row in res.json()["items"]}
    assert str(org_admin.id) not in ids
    assert str(owner.id) not in ids
    assert str(ws_admin.id) in ids


def test_space_admin_only_sees_space_members(client, db, org, owner):
    from app.models.project import ProjectMember, Space, SpaceMember
    from app.models.workspace import Workspace, WorkspaceMember
    from app.tests.helpers import build_project_stack

    org_admin = _add_member(db, org, "sp-hide-org-admin@test.dev", role="admin")
    ws_admin = _add_member(db, org, "sp-hide-ws-admin@test.dev", role="member")
    space_admin = _add_member(db, org, "sp-admin@test.dev", role="member")
    space_member = _add_member(db, org, "sp-member@test.dev", role="member")
    outside = _add_member(db, org, "sp-outside@test.dev", role="member")

    workspace, project = build_project_stack(db, org, owner)
    space = db.scalar(select(Space).where(Space.workspace_id == workspace.id))
    assert space is not None

    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=space_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=space_member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=org_admin.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=space_admin.id, role="admin"))
    db.add(SpaceMember(space_id=space.id, user_id=space_member.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=org_admin.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=ws_admin.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=space_admin.id, role="admin"))
    db.add(ProjectMember(project_id=project.id, user_id=space_member.id, role="member"))
    db.flush()

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, space_admin.email),
    )
    assert res.status_code == 200, res.text
    ids = {row["user"]["id"] for row in res.json()["items"]}
    assert str(space_admin.id) in ids
    assert str(space_member.id) in ids
    # Workspace admin in this space is surrounding → visible.
    assert str(ws_admin.id) in ids
    # Org leaders stay hidden even if space members.
    assert str(org_admin.id) not in ids
    assert str(owner.id) not in ids
    assert str(outside.id) not in ids


def test_project_admin_only_sees_project_members(client, db, org, owner):
    from app.models.project import ProjectMember
    from app.tests.helpers import build_project_stack

    org_admin = _add_member(db, org, "pr-hide-org-admin@test.dev", role="admin")
    proj_admin = _add_member(db, org, "pr-admin@test.dev", role="member")
    proj_member = _add_member(db, org, "pr-member@test.dev", role="member")
    ws_only = _add_member(db, org, "pr-ws-only@test.dev", role="member")

    workspace, project = build_project_stack(db, org, owner)
    from app.models.workspace import WorkspaceMember

    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=proj_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=proj_member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=org_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_only.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_member.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=org_admin.id, role="member"))
    db.flush()

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, proj_admin.email),
    )
    assert res.status_code == 200, res.text
    ids = {row["user"]["id"] for row in res.json()["items"]}
    assert str(proj_admin.id) in ids
    assert str(proj_member.id) in ids
    assert str(org_admin.id) not in ids
    assert str(owner.id) not in ids
    assert str(ws_only.id) not in ids


def test_workspace_admin_sees_other_ws_admin_when_they_join_as_member(client, db, org, owner):
    """A is WS admin of X; B is WS admin of Y but joined X as project member → A sees B."""
    from app.models.project import ProjectMember
    from app.models.workspace import Workspace, WorkspaceMember
    from app.tests.helpers import build_project_stack

    ws_admin_a = _add_member(db, org, "ws-a-admin@test.dev", role="member")
    ws_admin_b = _add_member(db, org, "ws-b-admin@test.dev", role="member")

    workspace_x, project_x = build_project_stack(db, org, owner, project_name="WAX")
    workspace_y = Workspace(organization_id=org.id, name="WS Y", created_by=owner.id)
    db.add(workspace_y)
    db.flush()

    db.add(WorkspaceMember(workspace_id=workspace_x.id, user_id=ws_admin_a.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace_y.id, user_id=ws_admin_b.id, role="admin"))
    # B joins A's surrounding as a project member (not admin of X).
    db.add(WorkspaceMember(workspace_id=workspace_x.id, user_id=ws_admin_b.id, role="member"))
    db.add(ProjectMember(project_id=project_x.id, user_id=ws_admin_b.id, role="member"))
    db.flush()

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, ws_admin_a.email),
    )
    assert res.status_code == 200, res.text
    ids = {row["user"]["id"] for row in res.json()["items"]}
    assert str(ws_admin_a.id) in ids
    assert str(ws_admin_b.id) in ids
    assert str(owner.id) not in ids


def test_workspace_admin_sees_workspace_members_only(client, db, org, owner):
    from app.models.workspace import Workspace, WorkspaceMember

    org_admin = _add_member(db, org, "ws-see-org-admin@test.dev", role="admin")
    ws_admin = _add_member(db, org, "ws-see-admin@test.dev", role="member")
    ws_member = _add_member(db, org, "ws-see-member@test.dev", role="member")
    outsider = _add_member(db, org, "ws-see-outsider@test.dev", role="member")

    workspace = Workspace(organization_id=org.id, name="WS Scope", created_by=owner.id)
    other = Workspace(organization_id=org.id, name="Other WS", created_by=owner.id)
    db.add(workspace)
    db.add(other)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=org_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=other.id, user_id=outsider.id, role="member"))
    db.flush()

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, ws_admin.email),
    )
    assert res.status_code == 200, res.text
    ids = {row["user"]["id"] for row in res.json()["items"]}
    assert str(ws_admin.id) in ids
    assert str(ws_member.id) in ids
    assert str(org_admin.id) not in ids
    assert str(owner.id) not in ids
    assert str(outsider.id) not in ids


def test_project_admin_sees_space_admin_and_peer_when_in_project(client, db, org, owner):
    """Surrounding membership wins — space admin / peer project admin in the project are visible."""
    from app.models.project import ProjectMember, Space, SpaceMember
    from app.models.workspace import WorkspaceMember
    from app.tests.helpers import build_project_stack
    from sqlalchemy import select

    space_admin = _add_member(db, org, "pr-see-sp-admin@test.dev", role="member")
    peer_admin = _add_member(db, org, "pr-see-peer-admin@test.dev", role="member")
    proj_admin = _add_member(db, org, "pr-self-admin2@test.dev", role="member")
    proj_member = _add_member(db, org, "pr-plain-member2@test.dev", role="member")

    workspace, project = build_project_stack(db, org, owner)
    space = db.scalar(select(Space).where(Space.workspace_id == workspace.id))
    assert space is not None

    for u in (space_admin, peer_admin, proj_admin, proj_member):
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=u.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=space_admin.id, role="admin"))
    db.add(SpaceMember(space_id=space.id, user_id=proj_admin.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=proj_member.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=peer_admin.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.add(ProjectMember(project_id=project.id, user_id=peer_admin.id, role="admin"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_member.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=space_admin.id, role="member"))
    db.flush()

    res = client.get(
        f"/api/v1/analytics/users?organization_id={org.id}",
        headers=auth_headers(client, proj_admin.email),
    )
    assert res.status_code == 200, res.text
    ids = {row["user"]["id"] for row in res.json()["items"]}
    assert str(proj_admin.id) in ids
    assert str(proj_member.id) in ids
    assert str(space_admin.id) in ids
    assert str(peer_admin.id) in ids
    assert str(owner.id) not in ids


def test_timeline_respects_viewer_profile_timezone(client, db, org, owner):
    from datetime import datetime, timezone

    from app.models.user import Profile

    profile = db.scalar(select(Profile).where(Profile.user_id == owner.id))
    assert profile is not None
    profile.timezone = "IST"
    db.flush()

    member = _add_member(db, org, "tz-member@test.dev")
    # 2026-07-06 01:30 IST = 2026-07-05 20:00 UTC
    login = datetime(2026, 7, 5, 20, 0, tzinfo=timezone.utc)
    logout = datetime(2026, 7, 5, 21, 0, tzinfo=timezone.utc)
    _add_session(db, member, login=login, logout=logout)

    res = client.get(
        f"/api/v1/analytics/timeline?organization_id={org.id}&date=2026-07-06",
        headers=auth_headers(client, owner.email),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["timezone"] == "Asia/Kolkata"
    assert body["date"] == "2026-07-06"
    online_by_hour = [p["online"] for p in body["points"]]
    assert max(online_by_hour) == 1
    assert online_by_hour[1] == 1
