"""Analytics aggregation + scope resolution for the Analytics module.

Scope is always derived from the authenticated user (never trusted from the
client): org owners/admins see the whole organization, while workspace/space/
project admins see only the people inside the scopes they administer.

Members equal to or above the viewer's role rank are excluded from every
aggregation (presence table, activity feed, trends, etc.) so lower admins
cannot observe their superiors' activity. Org owners and org admins share
full org visibility.
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.organization import OrganizationMember
from app.models.presence import PresenceEvent, UserPresence, UserSession
from app.models.project import Project, ProjectMember, Space, SpaceMember
from app.models.team import Team, TeamMember
from app.models.user import Profile
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.analytics import (
    ActivityFeedItem,
    AlertsOut,
    AnalyticsAlert,
    ContributionDay,
    ContributionHeatmapOut,
    DeviceAnalyticsOut,
    DeviceSlice,
    HeatmapCell,
    HeatmapOut,
    OverviewOut,
    PresenceUserRow,
    PresenceUsersPage,
    SessionInfo,
    StatusDistributionOut,
    StatusSlice,
    StatusTimelineItem,
    TeamActivityOut,
    TeamActivityRow,
    TimelineOut,
    TimelinePoint,
    TrendPoint,
    TrendsOut,
    UserDetailOut,
    WeeklyActivityDay,
)
from zoneinfo import ZoneInfo

from app.services.analytics_timezone import (
    local_day_bounds,
    local_hour_slots,
    overlaps,
    period_bounds,
    to_local_date,
    viewer_timezone,
)
from app.services.permission_service import PermissionError403, PermissionService
from app.services.presence_service import OFFLINE_AFTER, effective_status
from app.services.role_hierarchy_service import (
    can_viewer_see_member_in_analytics,
    resolve_user_highest_role,
)
from app.services.user_service import user_briefs

_STATUS_ORDER = {"online": 0, "busy": 1, "away": 2, "offline": 3}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """Normalize to UTC so hour/weekday bucketing is timezone-consistent.

    The DB driver may return tz-aware datetimes in the server's local zone, so
    naive values are assumed UTC and aware values are converted to UTC.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _session_presence_end(session: UserSession, now: datetime) -> datetime:
    """When presence for this session actually ended.

    Closed sessions use ``logout_time``. Open sessions use ``last_activity`` and
    only extend through ``now`` while the heartbeat is still within
    ``OFFLINE_AFTER`` — abandoned tabs must not count as online until "now".
    """
    if session.logout_time is not None:
        return _aware(session.logout_time)
    last = session.last_activity or session.login_time
    last = _aware(last)
    if now - last <= OFFLINE_AFTER:
        return now
    return last


@dataclass
class AnalyticsFilters:
    workspace_id: uuid.UUID | None = None
    space_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    status: str | None = None
    role: str | None = None
    search: str | None = None
    date: str | None = None


@dataclass
class AnalyticsScope:
    org_id: uuid.UUID
    user_ids: set[uuid.UUID] = field(default_factory=set)


# ---------------------------------------------------------------------------
# Scope resolution
# ---------------------------------------------------------------------------


def _org_member_ids(db: Session, org_id: uuid.UUID) -> set[uuid.UUID]:
    return set(
        db.scalars(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == org_id
            )
        ).all()
    )


def _members_of_workspaces(db: Session, workspace_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not workspace_ids:
        return set()
    return set(
        db.scalars(
            select(WorkspaceMember.user_id).where(
                WorkspaceMember.workspace_id.in_(workspace_ids)
            )
        ).all()
    )


def _members_of_spaces(db: Session, space_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not space_ids:
        return set()
    return set(
        db.scalars(
            select(SpaceMember.user_id).where(SpaceMember.space_id.in_(space_ids))
        ).all()
    )


def _members_of_projects(db: Session, project_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not project_ids:
        return set()
    return set(
        db.scalars(
            select(ProjectMember.user_id).where(ProjectMember.project_id.in_(project_ids))
        ).all()
    )


def _admin_workspace_ids(
    db: Session, perms: PermissionService, org_id: uuid.UUID
) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(WorkspaceMember.workspace_id)
            .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
            .where(
                Workspace.organization_id == org_id,
                Workspace.deleted_at.is_(None),
                WorkspaceMember.user_id == perms.user.id,
                WorkspaceMember.role.in_(("admin", "owner")),
            )
        ).all()
    )


def _admin_space_ids(db: Session, perms: PermissionService, org_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(SpaceMember.space_id)
            .join(Space, Space.id == SpaceMember.space_id)
            .join(Workspace, Workspace.id == Space.workspace_id)
            .where(
                Workspace.organization_id == org_id,
                Space.deleted_at.is_(None),
                SpaceMember.user_id == perms.user.id,
                SpaceMember.role == "admin",
            )
        ).all()
    )


def _admin_project_ids(
    db: Session, perms: PermissionService, org_id: uuid.UUID
) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(ProjectMember.project_id)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(
                Project.workspace_id.in_(
                    select(Workspace.id).where(Workspace.organization_id == org_id)
                ),
                Project.deleted_at.is_(None),
                ProjectMember.user_id == perms.user.id,
                ProjectMember.role == "admin",
            )
        ).all()
    )


def _base_scope_ids(db: Session, perms: PermissionService, org_id: uuid.UUID) -> set[uuid.UUID]:
    """User ids the requester may see, before filters / hierarchy trimming.

    Visibility population (who can be considered at all):
    - Org owner / org admin → every organization member
    - Workspace admin → members of workspaces they administer
    - Space admin → members of spaces they administer
    - Project admin → members of projects they administer

    Hierarchy trimming (see ``_filter_by_role_hierarchy``) then hides equal/higher
    ranks so workspace/space/project admins never see org leaders or peer admins.
    """
    org_role = perms.org_role(org_id)
    if org_role in ("owner", "admin"):
        return _org_member_ids(db, org_id)

    viewer_highest = resolve_user_highest_role(db, org_id, perms.user.id)
    ids: set[uuid.UUID] = {perms.user.id}

    if viewer_highest == "workspace_admin":
        ids |= _members_of_workspaces(db, _admin_workspace_ids(db, perms, org_id))
    elif viewer_highest == "space_admin":
        ids |= _members_of_spaces(db, _admin_space_ids(db, perms, org_id))
    elif viewer_highest == "project_admin":
        ids |= _members_of_projects(db, _admin_project_ids(db, perms, org_id))

    return ids & _org_member_ids(db, org_id) | {perms.user.id}


def _clamp_analytics_filters(
    db: Session, perms: PermissionService, org_id: uuid.UUID, filters: AnalyticsFilters
) -> AnalyticsFilters:
    """Ignore resource filters outside the viewer's administered scope."""
    org_role = perms.org_role(org_id)
    if org_role in ("owner", "admin"):
        return filters

    viewer_highest = resolve_user_highest_role(db, org_id, perms.user.id)
    allowed_ws = set(_admin_workspace_ids(db, perms, org_id))
    allowed_sp = set(_admin_space_ids(db, perms, org_id))
    allowed_pr = set(_admin_project_ids(db, perms, org_id))

    ws_id = filters.workspace_id
    sp_id = filters.space_id
    pr_id = filters.project_id
    team_id = filters.team_id

    if viewer_highest == "workspace_admin":
        if ws_id and ws_id not in allowed_ws:
            ws_id = None
    elif viewer_highest == "space_admin":
        if sp_id and sp_id not in allowed_sp:
            sp_id = None
        space_ws_ids = set(
            db.scalars(select(Space.workspace_id).where(Space.id.in_(allowed_sp))).all()
        ) if allowed_sp else set()
        if sp_id:
            ws_id = db.scalar(select(Space.workspace_id).where(Space.id == sp_id))
        elif ws_id and ws_id not in space_ws_ids:
            ws_id = None
        pr_id = None
    elif viewer_highest == "project_admin":
        if pr_id and pr_id not in allowed_pr:
            pr_id = None
        if pr_id:
            project = db.get(Project, pr_id)
            if project:
                ws_id = project.workspace_id
        sp_id = None

    return AnalyticsFilters(
        workspace_id=ws_id,
        space_id=sp_id,
        project_id=pr_id,
        team_id=team_id,
        status=filters.status,
        role=filters.role,
        search=filters.search,
        date=filters.date,
    )


def _apply_resource_filter(
    db: Session, perms: PermissionService, base: set[uuid.UUID], filters: AnalyticsFilters
) -> set[uuid.UUID]:
    """Narrow the base scope to a specific workspace/space/project/team the
    requester picked. The filter can only shrink the scope, never widen it."""
    ids = set(base)
    if filters.workspace_id:
        ids &= _members_of_workspaces(db, [filters.workspace_id])
    if filters.space_id:
        ids &= _members_of_spaces(db, [filters.space_id])
    if filters.project_id:
        ids &= _members_of_projects(db, [filters.project_id])
    if filters.team_id:
        team_ids = set(
            db.scalars(
                select(TeamMember.user_id).where(TeamMember.team_id == filters.team_id)
            ).all()
        )
        ids &= team_ids
    return ids


def _filter_by_role_hierarchy(
    db: Session, org_id: uuid.UUID, viewer_id: uuid.UUID, user_ids: set[uuid.UUID]
) -> set[uuid.UUID]:
    """Finalize who a viewer may see among an already surrounding-scoped set.

    ``user_ids`` must already be limited to the viewer's administered surrounding
    (workspace / space / project members). Then:

    - Org owner / org admin → keep everyone
    - Scoped admin → keep surrounding members, including admins of *other*
      workspaces/spaces/projects who joined this surrounding in any role;
      still hide org owner / org admin
    - Viewer always remains visible to themselves
    """
    if not user_ids:
        return user_ids

    viewer_highest = resolve_user_highest_role(db, org_id, viewer_id)
    if viewer_highest in ("org_owner", "org_admin"):
        return user_ids

    rank_cache: dict[uuid.UUID, str] = {viewer_id: viewer_highest}
    visible: set[uuid.UUID] = set()

    for uid in user_ids:
        if uid == viewer_id:
            visible.add(uid)
            continue
        target_highest = rank_cache.get(uid)
        if target_highest is None:
            target_highest = resolve_user_highest_role(db, org_id, uid)
            rank_cache[uid] = target_highest
        if can_viewer_see_member_in_analytics(viewer_highest, target_highest):
            visible.add(uid)

    return visible


def resolve_scope(
    db: Session,
    perms: PermissionService,
    org_id: uuid.UUID,
    filters: AnalyticsFilters | None = None,
) -> AnalyticsScope:
    perms.require_analytics_access(org_id)
    base = _base_scope_ids(db, perms, org_id)
    if filters is not None:
        filters = _clamp_analytics_filters(db, perms, org_id, filters)
        base = _apply_resource_filter(db, perms, base, filters)
    base = _filter_by_role_hierarchy(db, org_id, perms.user.id, base)
    return AnalyticsScope(org_id=org_id, user_ids=base)


# ---------------------------------------------------------------------------
# Helpers shared by the aggregations
# ---------------------------------------------------------------------------


def _presence_map(db: Session, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, UserPresence]:
    if not user_ids:
        return {}
    rows = db.scalars(
        select(UserPresence).where(UserPresence.user_id.in_(user_ids))
    ).all()
    return {r.user_id: r for r in rows}


def _open_sessions_map(db: Session, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, UserSession]:
    if not user_ids:
        return {}
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.user_id.in_(user_ids), UserSession.logout_time.is_(None))
        .order_by(UserSession.login_time.desc())
    ).all()
    out: dict[uuid.UUID, UserSession] = {}
    for row in rows:
        out.setdefault(row.user_id, row)  # newest wins (ordered desc)
    return out


def _status_counts(
    scope: AnalyticsScope, presences: dict[uuid.UUID, UserPresence], now: datetime
) -> dict[str, int]:
    counts = {"online": 0, "away": 0, "busy": 0, "offline": 0}
    for uid in scope.user_ids:
        presence = presences.get(uid)
        status = effective_status(
            presence.status if presence else None,
            presence.last_seen if presence else None,
            now,
        )
        counts[status] = counts.get(status, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# Public aggregations
# ---------------------------------------------------------------------------


def get_overview(db: Session, scope: AnalyticsScope, tz: ZoneInfo) -> OverviewOut:
    now = _now()
    presences = _presence_map(db, scope.user_ids)
    counts = _status_counts(scope, presences, now)

    start, end, _ = local_day_bounds(None, now, tz)
    sessions_today = (
        db.scalars(
            select(UserSession).where(
                UserSession.user_id.in_(scope.user_ids or {uuid.uuid4()}),
                UserSession.login_time >= start,
                UserSession.login_time < end,
            )
        ).all()
        if scope.user_ids
        else []
    )

    active_users = {s.user_id for s in sessions_today}
    durations: list[int] = []
    for s in sessions_today:
        if s.session_duration is not None:
            durations.append(s.session_duration)
        else:
            login = s.login_time
            if login.tzinfo is None:
                login = login.replace(tzinfo=timezone.utc)
            durations.append(max(0, int((now - login).total_seconds())))
    avg_duration = int(sum(durations) / len(durations)) if durations else 0

    return OverviewOut(
        total_members=len(scope.user_ids),
        online=counts["online"],
        offline=counts["offline"],
        busy=counts["busy"],
        away=counts["away"],
        average_session_duration=avg_duration,
        active_users_today=len(active_users),
    )


def get_status_distribution(db: Session, scope: AnalyticsScope) -> StatusDistributionOut:
    now = _now()
    presences = _presence_map(db, scope.user_ids)
    counts = _status_counts(scope, presences, now)
    slices = [StatusSlice(status=s, count=counts[s]) for s in ("online", "busy", "away", "offline")]  # type: ignore[arg-type]
    return StatusDistributionOut(total=len(scope.user_ids), slices=slices)


def get_timeline(
    db: Session, scope: AnalyticsScope, date_str: str | None, tz: ZoneInfo
) -> TimelineOut:
    now = _now()
    start, end, iso = local_day_bounds(date_str, now, tz)
    day = datetime.strptime(iso, "%Y-%m-%d").date()
    hour_slots = local_hour_slots(day, tz)
    points = [
        TimelinePoint(bucket=slot_start, online=0) for _, slot_start, _ in hour_slots
    ]
    if not scope.user_ids:
        return TimelineOut(date=iso, timezone=tz.key, points=points)

    sessions = db.scalars(
        select(UserSession).where(
            UserSession.user_id.in_(scope.user_ids),
            UserSession.login_time < end,
            or_(UserSession.logout_time.is_(None), UserSession.logout_time >= start),
        )
    ).all()

    buckets: list[set[uuid.UUID]] = [set() for _ in range(24)]
    for s in sessions:
        login = _aware(s.login_time)
        logout = _session_presence_end(s, now)
        span_start = max(login, start)
        span_end = min(logout, end)
        if span_end <= span_start:
            continue
        for hour, slot_start, slot_end in hour_slots:
            if overlaps(span_start, span_end, slot_start, slot_end):
                buckets[hour].add(s.user_id)

    for h in range(24):
        points[h].online = len(buckets[h])
    return TimelineOut(date=iso, timezone=tz.key, points=points)


def _workspace_names_map(
    db: Session, org_id: uuid.UUID, user_ids: set[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(WorkspaceMember.user_id, Workspace.name)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(
            Workspace.organization_id == org_id,
            Workspace.deleted_at.is_(None),
            WorkspaceMember.user_id.in_(user_ids),
        )
    ).all()
    out: dict[uuid.UUID, list[str]] = {}
    for uid, name in rows:
        out.setdefault(uid, []).append(name)
    return out


def _team_names_map(
    db: Session, org_id: uuid.UUID, user_ids: set[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(TeamMember.user_id, Team.name)
        .join(Team, Team.id == TeamMember.team_id)
        .join(Workspace, Workspace.id == Team.workspace_id)
        .where(
            Workspace.organization_id == org_id,
            Team.deleted_at.is_(None),
            TeamMember.user_id.in_(user_ids),
        )
    ).all()
    out: dict[uuid.UUID, list[str]] = {}
    for uid, name in rows:
        out.setdefault(uid, []).append(name)
    return out


def _org_role_map(db: Session, org_id: uuid.UUID, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(OrganizationMember.user_id, OrganizationMember.role).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id.in_(user_ids),
        )
    ).all()
    return {uid: role for uid, role in rows}


def get_users(
    db: Session, scope: AnalyticsScope, filters: AnalyticsFilters, page: int, page_size: int
) -> PresenceUsersPage:
    now = _now()
    presences = _presence_map(db, scope.user_ids)
    sessions = _open_sessions_map(db, scope.user_ids)
    briefs = user_briefs(db, list(scope.user_ids))
    ws_names = _workspace_names_map(db, scope.org_id, scope.user_ids)
    team_names = _team_names_map(db, scope.org_id, scope.user_ids)
    role_map = _org_role_map(db, scope.org_id, scope.user_ids)

    search = (filters.search or "").strip().lower()
    rows: list[PresenceUserRow] = []
    for uid in scope.user_ids:
        brief = briefs.get(uid)
        if brief is None:
            continue
        role = role_map.get(uid)
        if filters.role and role != filters.role:
            continue
        presence = presences.get(uid)
        last_seen = presence.last_seen if presence else None
        status = effective_status(
            presence.status if presence else None, last_seen, now
        )
        if filters.status and status != filters.status:
            continue
        if search:
            haystack = f"{brief.full_name} {brief.email}".lower()
            if search not in haystack:
                continue

        session = sessions.get(uid)
        login_time = session.login_time if session else None
        duration = None
        if session is not None:
            login = login_time
            if login and login.tzinfo is None:
                login = login.replace(tzinfo=timezone.utc)
            duration = max(0, int((now - login).total_seconds())) if login else None
        idle = None
        if last_seen is not None:
            ls = last_seen if last_seen.tzinfo else last_seen.replace(tzinfo=timezone.utc)
            idle = max(0, int((now - ls).total_seconds()))

        rows.append(
            PresenceUserRow(
                user=brief,
                status=status,  # type: ignore[arg-type]
                role=role,
                teams=team_names.get(uid, []),
                workspaces=ws_names.get(uid, []),
                login_time=login_time,
                last_seen=last_seen,
                session_duration=duration,
                idle_time=idle,
                device=session.device if session else None,
                browser=session.browser if session else None,
            )
        )

    rows.sort(key=lambda r: (_STATUS_ORDER.get(r.status, 9), r.user.full_name.lower()))
    total = len(rows)
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    start = (page - 1) * page_size
    return PresenceUsersPage(
        items=rows[start : start + page_size],
        total=total,
        page=page,
        page_size=page_size,
    )


def get_user_row(db: Session, scope: AnalyticsScope, user_id: uuid.UUID) -> PresenceUserRow:
    if user_id not in scope.user_ids:
        raise PermissionError403("User is outside your analytics scope")
    single = AnalyticsScope(org_id=scope.org_id, user_ids={user_id})
    page = get_users(db, single, AnalyticsFilters(), page=1, page_size=1)
    if not page.items:
        raise PermissionError403("User is outside your analytics scope")
    return page.items[0]


def _active_today_ids(
    db: Session, user_ids: set[uuid.UUID], now: datetime, tz: ZoneInfo
) -> set[uuid.UUID]:
    if not user_ids:
        return set()
    start, end, _ = local_day_bounds(None, now, tz)
    return set(
        db.scalars(
            select(UserSession.user_id).where(
                UserSession.user_id.in_(user_ids),
                UserSession.login_time >= start,
                UserSession.login_time < end,
            )
        ).all()
    )


def _team_activity_entities(
    db: Session, scope: AnalyticsScope, group_by: str
) -> list[tuple[str, str, str | None, set[uuid.UUID]]]:
    """Return (id, name, color, member_ids) tuples for the requested dimension,
    with membership already intersected against the caller's scope."""
    scope_ids = scope.user_ids
    entities: list[tuple[str, str, str | None, set[uuid.UUID]]] = []

    if group_by == "workspace":
        ws_rows = db.execute(
            select(Workspace.id, Workspace.name, Workspace.color).where(
                Workspace.organization_id == scope.org_id, Workspace.deleted_at.is_(None)
            )
        ).all()
        member_rows = db.execute(
            select(WorkspaceMember.workspace_id, WorkspaceMember.user_id).where(
                WorkspaceMember.workspace_id.in_([w.id for w in ws_rows])
            )
        ).all() if ws_rows else []
        members: dict[uuid.UUID, set[uuid.UUID]] = {}
        for wid, uid in member_rows:
            if uid in scope_ids:
                members.setdefault(wid, set()).add(uid)
        for w in ws_rows:
            entities.append((str(w.id), w.name, w.color, members.get(w.id, set())))

    elif group_by == "space":
        sp_rows = db.execute(
            select(Space.id, Space.name, Space.color)
            .join(Workspace, Workspace.id == Space.workspace_id)
            .where(Workspace.organization_id == scope.org_id, Space.deleted_at.is_(None))
        ).all()
        member_rows = db.execute(
            select(SpaceMember.space_id, SpaceMember.user_id).where(
                SpaceMember.space_id.in_([s.id for s in sp_rows])
            )
        ).all() if sp_rows else []
        members = {}
        for sid, uid in member_rows:
            if uid in scope_ids:
                members.setdefault(sid, set()).add(uid)
        for s in sp_rows:
            entities.append((str(s.id), s.name, s.color, members.get(s.id, set())))

    elif group_by == "project":
        # Exclude ClickUp-style Personal List projects — they are private per-user
        # lists, not real team projects for activity comparison.
        pr_rows = db.execute(
            select(Project.id, Project.name, Project.color).where(
                Project.workspace_id.in_(
                    select(Workspace.id).where(Workspace.organization_id == scope.org_id)
                ),
                Project.deleted_at.is_(None),
                Project.is_archived.is_(False),
                Project.is_personal.is_(False),
            )
        ).all()
        member_rows = db.execute(
            select(ProjectMember.project_id, ProjectMember.user_id).where(
                ProjectMember.project_id.in_([p.id for p in pr_rows])
            )
        ).all() if pr_rows else []
        members = {}
        for pid, uid in member_rows:
            if uid in scope_ids:
                members.setdefault(pid, set()).add(uid)
        for p in pr_rows:
            entities.append((str(p.id), p.name, p.color, members.get(p.id, set())))

    else:  # team (default)
        team_rows = db.execute(
            select(Team.id, Team.name, Team.color)
            .join(Workspace, Workspace.id == Team.workspace_id)
            .where(Workspace.organization_id == scope.org_id, Team.deleted_at.is_(None))
        ).all()
        member_rows = db.execute(
            select(TeamMember.team_id, TeamMember.user_id).where(
                TeamMember.team_id.in_([t.id for t in team_rows])
            )
        ).all() if team_rows else []
        members = {}
        for tid, uid in member_rows:
            if uid in scope_ids:
                members.setdefault(tid, set()).add(uid)
        for t in team_rows:
            entities.append((str(t.id), t.name, t.color, members.get(t.id, set())))

    # Drop entities with nobody in the viewer's scope (noise / empty shells).
    return [e for e in entities if e[3]]


def get_team_activity(
    db: Session, scope: AnalyticsScope, group_by: str, tz: ZoneInfo
) -> TeamActivityOut:
    group_by = group_by if group_by in ("team", "workspace", "space", "project") else "team"
    now = _now()
    presences = _presence_map(db, scope.user_ids)
    active_today = _active_today_ids(db, scope.user_ids, now, tz)

    rows: list[TeamActivityRow] = []
    for ent_id, name, color, member_ids in _team_activity_entities(db, scope, group_by):
        counts = {"online": 0, "busy": 0, "away": 0, "offline": 0}
        for uid in member_ids:
            presence = presences.get(uid)
            st = effective_status(
                presence.status if presence else None,
                presence.last_seen if presence else None,
                now,
            )
            counts[st] = counts.get(st, 0) + 1
        rows.append(
            TeamActivityRow(
                id=ent_id,
                name=name,
                color=color,
                member_count=len(member_ids),
                online=counts["online"],
                busy=counts["busy"],
                away=counts["away"],
                offline=counts["offline"],
                active_today=len(member_ids & active_today),
            )
        )

    rows.sort(key=lambda r: (-r.online, -r.member_count, r.name.lower()))
    return TeamActivityOut(group_by=group_by, rows=rows)


def _session_info(session: UserSession, now: datetime) -> SessionInfo:
    login = _aware(session.login_time)
    end = _session_presence_end(session, now)
    if session.logout_time is not None and session.session_duration is not None:
        duration = session.session_duration
    else:
        duration = max(0, int((end - login).total_seconds()))
    still_active = session.logout_time is None and end == now
    return SessionInfo(
        id=session.id,
        login_time=session.login_time,
        logout_time=session.logout_time,
        last_activity=session.last_activity,
        duration=duration,
        device=session.device,
        browser=session.browser,
        ip_address=session.ip_address,
        active=still_active,
    )


def get_user_detail(
    db: Session, scope: AnalyticsScope, user_id: uuid.UUID, tz: ZoneInfo
) -> UserDetailOut:
    row = get_user_row(db, scope, user_id)
    now = _now()

    profile = db.scalar(select(Profile).where(Profile.user_id == user_id))

    sessions = db.scalars(
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.login_time.desc())
        .limit(20)
    ).all()
    session_infos = [_session_info(s, now) for s in sessions]
    current = next((s for s in session_infos if s.active), None)
    recent = [s for s in session_infos if not s.active][:5]

    # Weekly activity: last 7 local calendar days in the viewer's timezone.
    _, _, week_days = period_bounds(7, now, tz)
    week_start, _, _ = local_day_bounds(week_days[0].isoformat(), now, tz)
    week_sessions = db.scalars(
        select(UserSession).where(
            UserSession.user_id == user_id, UserSession.login_time >= week_start
        )
    ).all()
    per_day: dict[str, tuple[int, int]] = {}
    for day in week_days:
        per_day[day.isoformat()] = (0, 0)
    for s in week_sessions:
        login = _aware(s.login_time)
        key = to_local_date(login, tz).isoformat()
        if key not in per_day:
            continue
        logout = _session_presence_end(s, now)
        secs = max(0, int((logout - login).total_seconds()))
        count, total = per_day[key]
        per_day[key] = (count + 1, total + secs)
    weekly = [
        WeeklyActivityDay(date=day, session_count=c, total_seconds=t)
        for day, (c, t) in sorted(per_day.items())
    ]

    events = db.scalars(
        select(PresenceEvent)
        .where(PresenceEvent.user_id == user_id)
        .order_by(PresenceEvent.created_at.desc())
        .limit(30)
    ).all()
    timeline = [
        StatusTimelineItem(
            event_type=e.event_type,
            old_status=e.old_status,
            new_status=e.new_status,
            created_at=e.created_at,
        )
        for e in events
    ]

    return UserDetailOut(
        row=row,
        title=profile.title if profile else None,
        timezone=profile.timezone if profile else None,
        current_session=current,
        recent_sessions=recent,
        weekly_activity=weekly,
        status_timeline=timeline,
    )


# ---------------------------------------------------------------------------
# Phase 3: historical trends, heatmap, device analytics, alerts
# ---------------------------------------------------------------------------


def _clamp_days(days: int) -> int:
    return max(1, min(days, 365))


def _sessions_in_window(
    db: Session, user_ids: set[uuid.UUID], start: datetime, end: datetime
) -> list[UserSession]:
    """Every session that overlaps [start, end)."""
    if not user_ids:
        return []
    return list(
        db.scalars(
            select(UserSession).where(
                UserSession.user_id.in_(user_ids),
                UserSession.login_time < end,
                or_(UserSession.logout_time.is_(None), UserSession.logout_time >= start),
            )
        ).all()
    )


def get_trends(db: Session, scope: AnalyticsScope, days: int, tz: ZoneInfo) -> TrendsOut:
    days = _clamp_days(days)
    now = _now()
    start, end, day_keys = period_bounds(days, now, tz)
    sessions = _sessions_in_window(db, scope.user_ids, start, end)

    active: dict[str, set[uuid.UUID]] = {d.isoformat(): set() for d in day_keys}
    session_count: dict[str, int] = {d.isoformat(): 0 for d in day_keys}
    durations: dict[str, list[int]] = {d.isoformat(): [] for d in day_keys}
    hourly: dict[str, list[set[uuid.UUID]]] = {
        d.isoformat(): [set() for _ in range(24)] for d in day_keys
    }
    hour_slots_by_day = {d.isoformat(): local_hour_slots(d, tz) for d in day_keys}

    for s in sessions:
        login = _aware(s.login_time)
        logout = _session_presence_end(s, now)
        login_key = to_local_date(login, tz).isoformat()
        if login_key in active:
            active[login_key].add(s.user_id)
            session_count[login_key] += 1
            if s.session_duration is not None:
                durations[login_key].append(s.session_duration)
            else:
                durations[login_key].append(max(0, int((logout - login).total_seconds())))
        span_start = max(login, start)
        span_end = min(logout, end)
        if span_end <= span_start:
            continue
        for day_key, slots in hour_slots_by_day.items():
            for hour, slot_start, slot_end in slots:
                if overlaps(span_start, span_end, slot_start, slot_end):
                    hourly[day_key][hour].add(s.user_id)

    points: list[TrendPoint] = []
    for d in day_keys:
        key = d.isoformat()
        ds = durations[key]
        peak = max((len(h) for h in hourly[key]), default=0)
        points.append(
            TrendPoint(
                date=key,
                active_users=len(active[key]),
                peak_online=peak,
                total_sessions=session_count[key],
                avg_session_duration=int(sum(ds) / len(ds)) if ds else 0,
            )
        )

    peak_online = max((p.peak_online for p in points), default=0)
    avg_active = int(sum(p.active_users for p in points) / len(points)) if points else 0

    half = len(points) // 2
    growth = "0%"
    if half > 0:
        first = points[:half]
        second = points[half:]
        first_avg = sum(p.active_users for p in first) / len(first) if first else 0
        second_avg = sum(p.active_users for p in second) / len(second) if second else 0
        if first_avg > 0:
            pct = round(((second_avg - first_avg) / first_avg) * 100)
            growth = f"{'+' if pct >= 0 else ''}{pct}%"
        elif second_avg > 0:
            growth = "+100%"

    return TrendsOut(
        days=days,
        timezone=tz.key,
        points=points,
        peak_online=peak_online,
        avg_active_users=avg_active,
        growth=growth,
    )


def get_heatmap(db: Session, scope: AnalyticsScope, days: int, tz: ZoneInfo) -> HeatmapOut:
    days = _clamp_days(days)
    now = _now()
    start, end, _ = period_bounds(days, now, tz)
    sessions = _sessions_in_window(db, scope.user_ids, start, end)

    # grid[weekday][hour] = distinct-user-hours summed across the window.
    grid: list[list[set[tuple[uuid.UUID, str]]]] = [
        [set() for _ in range(24)] for _ in range(7)
    ]
    for s in sessions:
        login = _aware(s.login_time)
        logout = _session_presence_end(s, now)
        span_start = max(login, start)
        span_end = min(logout, end)
        if span_end < span_start:
            continue
        cur = span_start.astimezone(tz).replace(minute=0, second=0, microsecond=0)
        end_local = span_end.astimezone(tz)
        while cur < end_local:
            grid[cur.weekday()][cur.hour].add((s.user_id, cur.isoformat()))
            cur += timedelta(hours=1)

    cells: list[HeatmapCell] = []
    max_value = 0
    for wd in range(7):
        for hr in range(24):
            value = len(grid[wd][hr])
            max_value = max(max_value, value)
            if value:
                cells.append(HeatmapCell(weekday=wd, hour=hr, value=value))
    return HeatmapOut(days=days, max_value=max_value, cells=cells)


def get_contribution_heatmap(
    db: Session, scope: AnalyticsScope, days: int, tz: ZoneInfo
) -> ContributionHeatmapOut:
    """Daily calendar heatmap — distinct active users per local calendar day."""
    days = _clamp_days(days)
    now = _now()
    start, end, day_keys = period_bounds(days, now, tz)
    sessions = _sessions_in_window(db, scope.user_ids, start, end)

    active: dict[str, set[uuid.UUID]] = {d.isoformat(): set() for d in day_keys}

    for session in sessions:
        login = _aware(session.login_time)
        logout = _session_presence_end(session, now)
        span_start = max(login, start)
        span_end = min(logout, end)
        if span_end <= span_start:
            continue
        cur_date = to_local_date(span_start, tz)
        last_date = to_local_date(span_end, tz)
        while cur_date <= last_date:
            key = cur_date.isoformat()
            if key in active:
                active[key].add(session.user_id)
            cur_date += timedelta(days=1)

    points = [ContributionDay(date=key, count=len(active[key])) for key in sorted(active)]
    max_count = max((p.count for p in points), default=0)
    return ContributionHeatmapOut(days=days, timezone=tz.key, max_count=max_count, points=points)


def get_device_analytics(db: Session, scope: AnalyticsScope, days: int, tz: ZoneInfo) -> DeviceAnalyticsOut:
    days = _clamp_days(days)
    now = _now()
    start, end, _ = period_bounds(days, now, tz)
    sessions = _sessions_in_window(db, scope.user_ids, start, end)

    device_sessions: dict[str, int] = {}
    device_users: dict[str, set[uuid.UUID]] = {}
    browser_sessions: dict[str, int] = {}
    browser_users: dict[str, set[uuid.UUID]] = {}

    for s in sessions:
        dev = s.device or "Unknown"
        br = s.browser or "Unknown"
        device_sessions[dev] = device_sessions.get(dev, 0) + 1
        device_users.setdefault(dev, set()).add(s.user_id)
        browser_sessions[br] = browser_sessions.get(br, 0) + 1
        browser_users.setdefault(br, set()).add(s.user_id)

    def _slices(counts: dict[str, int], users: dict[str, set[uuid.UUID]]) -> list[DeviceSlice]:
        return sorted(
            (
                DeviceSlice(name=name, sessions=count, users=len(users[name]))
                for name, count in counts.items()
            ),
            key=lambda s: -s.sessions,
        )

    return DeviceAnalyticsOut(
        days=days,
        total_sessions=len(sessions),
        devices=_slices(device_sessions, device_users),
        browsers=_slices(browser_sessions, browser_users),
    )


# Thresholds for computed alerts.
_IDLE_ALERT_SECONDS = 30 * 60
_STALE_SESSION_SECONDS = 12 * 3600


def get_alerts(db: Session, scope: AnalyticsScope, tz: ZoneInfo) -> AlertsOut:
    now = _now()
    presences = _presence_map(db, scope.user_ids)
    counts = _status_counts(scope, presences, now)
    total = len(scope.user_ids)
    active_today = _active_today_ids(db, scope.user_ids, now, tz)
    alerts: list[AnalyticsAlert] = []

    if total > 0 and counts["online"] == 0:
        alerts.append(
            AnalyticsAlert(
                id="no_one_online",
                level="warning",
                title="No one is online",
                description="Nobody in this scope is currently active.",
                count=0,
            )
        )

    if total > 0:
        active_pct = len(active_today) / total
        if active_pct < 0.25:
            alerts.append(
                AnalyticsAlert(
                    id="low_engagement",
                    level="warning",
                    title="Low engagement today",
                    description=(
                        f"Only {len(active_today)} of {total} members "
                        f"({round(active_pct * 100)}%) have been active today."
                    ),
                    count=len(active_today),
                )
            )

    # Idle-but-online users (heartbeat stale-ish but not yet offline).
    idle_users = 0
    for uid in scope.user_ids:
        presence = presences.get(uid)
        if presence is None or presence.last_seen is None:
            continue
        status = effective_status(presence.status, presence.last_seen, now)
        if status == "offline":
            continue
        idle = (now - _aware(presence.last_seen)).total_seconds()
        if idle >= _IDLE_ALERT_SECONDS:
            idle_users += 1
    if idle_users:
        alerts.append(
            AnalyticsAlert(
                id="idle_users",
                level="info",
                title="Idle users detected",
                description=f"{idle_users} user(s) appear online but have been idle for 30+ minutes.",
                count=idle_users,
            )
        )

    # Very long open sessions — likely forgotten/never-closed sessions.
    open_sessions = _open_sessions_map(db, scope.user_ids)
    stale = 0
    for session in open_sessions.values():
        duration = (now - _aware(session.login_time)).total_seconds()
        if duration >= _STALE_SESSION_SECONDS:
            stale += 1
    if stale:
        alerts.append(
            AnalyticsAlert(
                id="stale_sessions",
                level="info",
                title="Unusually long sessions",
                description=f"{stale} session(s) have stayed open for over 12 hours.",
                count=stale,
            )
        )

    if not alerts:
        alerts.append(
            AnalyticsAlert(
                id="all_clear",
                level="info",
                title="All clear",
                description="No presence anomalies detected in this scope.",
                count=0,
            )
        )

    return AlertsOut(generated_at=now, alerts=alerts)


def get_activity_feed(
    db: Session, scope: AnalyticsScope, limit: int = 50
) -> list[ActivityFeedItem]:
    if not scope.user_ids:
        return []
    limit = max(1, min(limit, 200))
    events = db.scalars(
        select(PresenceEvent)
        .where(PresenceEvent.user_id.in_(scope.user_ids))
        .order_by(PresenceEvent.created_at.desc())
        .limit(limit)
    ).all()
    briefs = user_briefs(db, [e.user_id for e in events])
    items: list[ActivityFeedItem] = []
    for e in events:
        item = ActivityFeedItem.model_validate(e)
        item.user = briefs.get(e.user_id)
        items.append(item)
    return items
