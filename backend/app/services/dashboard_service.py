"""Dashboard aggregates for every admin scope (org / workspace / space / project)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.task_ref import format_task_ref
from app.models.activity import ActivityLog
from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space, SpaceMember
from app.models.sprint import Sprint, SprintTask
from app.models.task import CustomStatus, Task, TaskAssignee
from app.models.team import Team, TeamMember
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.dashboard import (
    CriticalTaskRow,
    DashboardActivityRow,
    DashboardKpis,
    DashboardTrend,
    MemberWorkloadRow,
    DeliveryVelocitySummary,
    DeliveryVelocityTrendPoint,
    OrgDashboardOut,
    ProjectDashboardKpis,
    ProjectDashboardOut,
    ProjectMemberDashboardKpis,
    ProjectMemberDashboardOut,
    ProjectPortfolioRow,
    ProjectProgressRow,
    SpaceDashboardKpis,
    SpaceDashboardOut,
    SpaceOverviewRow,
    SprintSummaryRow,
    TeamProductivityRow,
    TeamProductivitySeries,
    TeamProductivitySummary,
    TeamProductivityTrendPoint,
    TeamWorkloadRow,
    UserRoleSummary,
    WorkspaceDashboardKpis,
    WorkspaceDashboardOut,
    WorkspaceRoleItem,
    SpaceRoleItem,
    ProjectRoleItem,
)
from app.schemas.workspace import StatusCount
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

RECENT_ACTIVITY_LIMIT = 100
CRITICAL_TASKS_LIMIT = 250
TEAM_PRODUCTIVITY_CHART_DAYS = 7
TEAM_PRODUCTIVITY_CHART_TOP_N = 5
TEAM_PRODUCTIVITY_WORKSPACE_ROLLUP_THRESHOLD = 12
OTHER_TEAM_CHART_KEY = "__other__"
OTHER_TEAM_COLOR = "#94a3b8"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return _now().date()


def _trend(delta: int, *, unit: str, positive_is_good: bool = True) -> DashboardTrend:
    if delta == 0:
        return DashboardTrend(label="No change", direction="flat", tone="neutral")
    direction = "up" if delta > 0 else "down"
    good = (delta > 0) == positive_is_good
    tone = "positive" if good else "negative"
    sign = "+" if delta > 0 else ""
    return DashboardTrend(label=f"{sign}{delta} vs {unit}", direction=direction, tone=tone)


def _pct_delta(current: int, previous: int) -> DashboardTrend:
    delta = current - previous
    if delta == 0:
        return DashboardTrend(label="No change", direction="flat", tone="neutral")
    direction = "up" if delta > 0 else "down"
    tone = "positive" if delta > 0 else "negative"
    sign = "+" if delta > 0 else ""
    return DashboardTrend(label=f"{sign}{delta}% vs last week", direction=direction, tone=tone)


def _dashboard_workspace_ids(perms: PermissionService, org_id: uuid.UUID) -> list[uuid.UUID]:
    org_role = perms.org_role(org_id)
    if org_role in ("owner", "admin"):
        return list(
            perms.db.scalars(
                select(Workspace.id).where(
                    Workspace.organization_id == org_id,
                    Workspace.deleted_at.is_(None),
                )
            ).all()
        )
    return list(
        perms.db.scalars(
            select(WorkspaceMember.workspace_id)
            .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
            .where(
                Workspace.organization_id == org_id,
                Workspace.deleted_at.is_(None),
                WorkspaceMember.user_id == perms.user.id,
            )
        ).all()
    )

def _open_task_filter(project_ids: list[uuid.UUID]):
    return [
        Task.project_id.in_(project_ids),
        Task.deleted_at.is_(None),
        Task.is_archived.is_(False),
        Task.parent_task_id.is_(None),
        Task.completed_at.is_(None),
    ]


def _critical_task_condition(today: date):
    return or_(
        and_(Task.due_date.is_not(None), Task.due_date < today),
        Task.due_date == today,
        Task.priority == "urgent",
    )


def _critical_task_order(today: date):
    return (
        case(
            (and_(Task.due_date.is_not(None), Task.due_date < today), 0),
            (Task.due_date == today, 1),
            (Task.priority == "urgent", 2),
            else_=4,
        ),
        Task.due_date.asc().nulls_last(),
    )


def _critical_kind(task: Task, status: CustomStatus | None, today: date) -> str:
    if task.due_date is not None and task.due_date < today:
        return "overdue"
    if task.priority == "urgent":
        return "critical"
    return "due_soon"


def _activity_summary(action: str, data: dict) -> str:
    title = data.get("title") or data.get("name") or data.get("task_title")
    if action.startswith("github."):
        return str(data.get("summary") or "GitHub activity")
    if title:
        return str(title)
    return action.replace(".", " ").replace("_", " ")


def build_org_dashboard(
    db: Session, perms: PermissionService, org_id: uuid.UUID, *, days: int = 7
) -> OrgDashboardOut:
    org = perms.get_org_or_404(org_id)
    workspace_ids = _dashboard_workspace_ids(perms, org_id)
    today = _today()
    month_ago = today - timedelta(days=30)
    week_ago = today - timedelta(days=7)
    period_days = max(7, min(days, 90))
    period_start = today - timedelta(days=period_days)

    if not workspace_ids:
        return OrgDashboardOut(
            organization_id=org.id,
            organization_name=org.name,
            kpis=DashboardKpis(
                active_projects=0,
                organization_members=db.scalar(
                    select(func.count(OrganizationMember.id)).where(
                        OrganizationMember.organization_id == org_id
                    )
                )
                or 0,
                teams=0,
                active_sprints=0,
                overdue_tasks=0,
                completion_percent=0,
                workspaces=0,
                trends={
                    k: DashboardTrend(label="No change", direction="flat", tone="neutral")
                    for k in (
                        "active_projects",
                        "organization_members",
                        "teams",
                        "active_sprints",
                        "overdue_tasks",
                        "completion_percent",
                        "workspaces",
                    )
                },
            ),
            project_progress=[],
            task_status_total=0,
            task_status_breakdown=[],
            team_workload=[],
            team_productivity=[],
            team_productivity_series=[],
            team_productivity_trend=[],
            team_productivity_summary=TeamProductivitySummary(),
            delivery_velocity_trend=[],
            delivery_velocity_summary=DeliveryVelocitySummary(),
            critical_tasks=[],
            recent_activities=[],
            project_portfolio=[],
            project_progress_total=0,
            team_workload_total=0,
            team_productivity_total=0,
            critical_tasks_total=0,
        )

    projects = list(
        db.scalars(
            select(Project).where(
                Project.workspace_id.in_(workspace_ids),
                Project.deleted_at.is_(None),
                Project.is_archived.is_(False),
            ).order_by(Project.name)
        ).all()
    )
    project_ids = [p.id for p in projects]

    # --- KPIs ---
    active_projects = len(projects)
    projects_delta = sum(1 for p in projects if p.created_at and p.created_at.date() >= month_ago)

    org_members = db.scalar(
        select(func.count(OrganizationMember.id)).where(OrganizationMember.organization_id == org_id)
    ) or 0
    members_delta = db.scalar(
        select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.created_at >= datetime.combine(month_ago, datetime.min.time(), tzinfo=timezone.utc),
        )
    ) or 0

    teams = list(
        db.scalars(
            select(Team).where(
                Team.workspace_id.in_(workspace_ids),
                Team.deleted_at.is_(None),
            )
        ).all()
    )
    teams_delta = sum(1 for t in teams if t.created_at and t.created_at.date() >= month_ago)

    workspaces_delta = db.scalar(
        select(func.count(Workspace.id)).where(
            Workspace.id.in_(workspace_ids),
            Workspace.created_at >= datetime.combine(month_ago, datetime.min.time(), tzinfo=timezone.utc),
        )
    ) or 0

    active_sprints = db.scalar(
        select(func.count(Sprint.id)).where(
            Sprint.workspace_id.in_(workspace_ids),
            Sprint.deleted_at.is_(None),
            Sprint.status == "active",
        )
    ) or 0
    sprints_delta = db.scalar(
        select(func.count(Sprint.id)).where(
            Sprint.workspace_id.in_(workspace_ids),
            Sprint.deleted_at.is_(None),
            Sprint.status == "active",
            Sprint.started_at.is_not(None),
            Sprint.started_at >= datetime.combine(week_ago, datetime.min.time(), tzinfo=timezone.utc),
        )
    ) or 0

    overdue_tasks = 0
    total_open = 0
    done_tasks = 0
    if project_ids:
        overdue_tasks = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter(project_ids),
                Task.due_date.is_not(None),
                Task.due_date < today,
            )
        ) or 0
        total_open = db.scalar(select(func.count(Task.id)).where(*_open_task_filter(project_ids))) or 0
        done_tasks = db.scalar(
            select(func.count(Task.id)).where(
                Task.project_id.in_(project_ids),
                Task.deleted_at.is_(None),
                Task.is_archived.is_(False),
                Task.parent_task_id.is_(None),
                Task.completed_at.is_not(None),
            )
        ) or 0

    overdue_week_ago = 0
    if project_ids:
        overdue_week_ago = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter(project_ids),
                Task.due_date.is_not(None),
                Task.due_date < week_ago,
            )
        ) or 0

    total_tasks = total_open + done_tasks
    completion_percent = round((done_tasks / total_tasks) * 100) if total_tasks else 0

    done_last_week = 0
    if project_ids:
        done_last_week = db.scalar(
            select(func.count(Task.id)).where(
                Task.project_id.in_(project_ids),
                Task.deleted_at.is_(None),
                Task.is_archived.is_(False),
                Task.parent_task_id.is_(None),
                Task.completed_at.is_not(None),
                Task.completed_at >= datetime.combine(week_ago, datetime.min.time(), tzinfo=timezone.utc),
            )
        ) or 0
    completion_prev = (
        round((max(0, done_tasks - done_last_week) / max(1, total_tasks - done_last_week)) * 100)
        if total_tasks
        else 0
    )

    kpis = DashboardKpis(
        active_projects=active_projects,
        organization_members=int(org_members),
        teams=len(teams),
        active_sprints=int(active_sprints),
        overdue_tasks=int(overdue_tasks),
        completion_percent=completion_percent,
        workspaces=len(workspace_ids),
        trends={
            "active_projects": _trend(projects_delta, unit="last month", positive_is_good=True),
            "organization_members": _trend(int(members_delta), unit="last month", positive_is_good=True),
            "teams": _trend(teams_delta, unit="last month", positive_is_good=True),
            "active_sprints": _trend(int(sprints_delta), unit="last week", positive_is_good=True),
            "overdue_tasks": _trend(int(overdue_tasks - overdue_week_ago), unit="last week", positive_is_good=False),
            "completion_percent": _pct_delta(completion_percent, completion_prev),
            "workspaces": _trend(int(workspaces_delta), unit="last month"),
        },
    )

    # --- Project progress ---
    project_progress: list[ProjectProgressRow] = []
    project_stats: dict[uuid.UUID, tuple[int, int, int]] = {}
    for project in projects:
        total = db.scalar(
            select(func.count(Task.id)).where(
                Task.project_id == project.id,
                Task.deleted_at.is_(None),
                Task.is_archived.is_(False),
                Task.parent_task_id.is_(None),
            )
        ) or 0
        done = db.scalar(
            select(func.count(Task.id)).where(
                Task.project_id == project.id,
                Task.deleted_at.is_(None),
                Task.is_archived.is_(False),
                Task.parent_task_id.is_(None),
                Task.completed_at.is_not(None),
            )
        ) or 0
        overdue = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter([project.id]),
                Task.due_date.is_not(None),
                Task.due_date < today,
            )
        ) or 0
        pct = round((done / total) * 100) if total else 0
        project_stats[project.id] = (int(total), int(done), int(overdue))
        project_progress.append(
            ProjectProgressRow(
                project_id=project.id,
                name=project.name,
                color=project.color,
                progress_percent=pct,
            )
        )
    project_progress.sort(key=lambda r: r.progress_percent, reverse=True)

    # --- Task status distribution ---
    status_rows = []
    if project_ids:
        status_rows = db.execute(
            select(CustomStatus.name, CustomStatus.color, func.count(Task.id))
            .join(Task, Task.status_id == CustomStatus.id)
            .where(*_open_task_filter(project_ids))
            .group_by(CustomStatus.name, CustomStatus.color)
            .order_by(func.count(Task.id).desc())
        ).all()
    task_status_breakdown = [StatusCount(name=r[0], color=r[1], count=r[2]) for r in status_rows]
    task_total = sum(s.count for s in task_status_breakdown)

    # --- Team workload & productivity ---
    team_workload: list[TeamWorkloadRow] = []
    team_productivity: list[TeamProductivityRow] = []
    period_start_dt = datetime.combine(period_start, datetime.min.time(), tzinfo=timezone.utc)

    for team in teams:
        member_ids = list(
            db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == team.id)).all()
        )
        open_assigned = 0
        overdue_assigned = 0
        completed = 0
        if member_ids and project_ids:
            open_assigned = db.scalar(
                select(func.count(Task.id.distinct()))
                .join(TaskAssignee, TaskAssignee.task_id == Task.id)
                .where(
                    *_open_task_filter(project_ids),
                    TaskAssignee.user_id.in_(member_ids),
                )
            ) or 0
            overdue_assigned = db.scalar(
                select(func.count(Task.id.distinct()))
                .join(TaskAssignee, TaskAssignee.task_id == Task.id)
                .where(
                    *_open_task_filter(project_ids),
                    Task.due_date.is_not(None),
                    Task.due_date < today,
                    TaskAssignee.user_id.in_(member_ids),
                )
            ) or 0
            completed = db.scalar(
                select(func.count(Task.id.distinct()))
                .join(TaskAssignee, TaskAssignee.task_id == Task.id)
                .where(
                    Task.project_id.in_(project_ids),
                    Task.deleted_at.is_(None),
                    Task.completed_at.is_not(None),
                    Task.completed_at >= period_start_dt,
                    TaskAssignee.user_id.in_(member_ids),
                )
            ) or 0

        team_workload.append(
            TeamWorkloadRow(
                team_id=team.id,
                name=team.name,
                color=team.color,
                member_count=len(member_ids),
                open_tasks=int(open_assigned),
                overdue_tasks=int(overdue_assigned),
                completed_tasks=int(completed),
            )
        )
        team_productivity.append(
            TeamProductivityRow(team_id=team.id, name=team.name, completed_count=int(completed))
        )

    team_workload_total = len(team_workload)
    team_productivity_total = len(team_productivity)
    team_workload.sort(key=lambda r: (r.overdue_tasks, r.open_tasks), reverse=True)
    team_productivity.sort(key=lambda r: r.completed_count, reverse=True)

    prod_series, prod_trend, prod_summary = _build_team_productivity_chart(
        db, teams, project_ids, today
    )
    velocity_trend, velocity_summary = _build_delivery_velocity(db, project_ids, today)

    # --- Critical tasks ---
    critical: list[CriticalTaskRow] = []
    critical_tasks_total = 0
    if project_ids:
        crit_base = (
            select(Task)
            .join(Project, Project.id == Task.project_id)
            .outerjoin(CustomStatus, CustomStatus.id == Task.status_id)
            .where(*_open_task_filter(project_ids), _critical_task_condition(today))
        )
        critical_tasks_total = (
            db.scalar(
                select(func.count(Task.id))
                .join(Project, Project.id == Task.project_id)
                .outerjoin(CustomStatus, CustomStatus.id == Task.status_id)
                .where(*_open_task_filter(project_ids), _critical_task_condition(today))
            )
            or 0
        )
        crit_tasks = db.scalars(
            crit_base.order_by(*_critical_task_order(today)).limit(CRITICAL_TASKS_LIMIT)
        ).all()
        project_map = {p.id: p for p in projects}
        task_ids = [t.id for t in crit_tasks]
        assignee_by_task: dict[uuid.UUID, uuid.UUID] = {}
        if task_ids:
            for tid, uid in db.execute(
                select(TaskAssignee.task_id, TaskAssignee.user_id).where(
                    TaskAssignee.task_id.in_(task_ids)
                )
            ).all():
                assignee_by_task.setdefault(tid, uid)
        briefs = user_briefs(db, list(set(assignee_by_task.values())))
        status_ids = {t.status_id for t in crit_tasks if t.status_id}
        status_map: dict[uuid.UUID, CustomStatus] = {}
        if status_ids:
            status_map = {
                s.id: s
                for s in db.scalars(
                    select(CustomStatus).where(CustomStatus.id.in_(status_ids))
                ).all()
            }

        for task in crit_tasks:
            proj = project_map.get(task.project_id)
            if not proj:
                continue
            status = status_map.get(task.status_id) if task.status_id else None
            status_name = status.name if status else "No status"
            status_color = status.color if status else "#87909E"
            kind = _critical_kind(task, status, today)
            aid = assignee_by_task.get(task.id)
            critical.append(
                CriticalTaskRow(
                    task_id=task.id,
                    title=task.title,
                    project_id=proj.id,
                    project_name=proj.name,
                    task_ref=format_task_ref(proj.id, task.number),
                    assignee=briefs.get(aid) if aid else None,
                    due_date=task.due_date,
                    status_name=status_name,
                    status_color=status_color,
                    status_kind=kind,
                )
            )

    # --- Recent activities ---
    recent: list[DashboardActivityRow] = []
    if workspace_ids:
        logs = db.scalars(
            select(ActivityLog)
            .where(
                ActivityLog.workspace_id.in_(workspace_ids),
                ActivityLog.created_at >= period_start_dt,
            )
            .order_by(ActivityLog.created_at.desc())
            .limit(RECENT_ACTIVITY_LIMIT)
        ).all()
        actor_ids = [log.actor_id for log in logs if log.actor_id]
        briefs = user_briefs(db, actor_ids)
        proj_names = {p.id: p.name for p in projects}
        for log in logs:
            recent.append(
                DashboardActivityRow(
                    id=log.id,
                    action=log.action,
                    summary=_activity_summary(log.action, log.data or {}),
                    actor=briefs.get(log.actor_id) if log.actor_id else None,
                    project_name=proj_names.get(log.project_id) if log.project_id else None,
                    created_at=log.created_at,
                )
            )

    # --- Project portfolio ---
    active_sprint_map: dict[uuid.UUID, str] = {}
    if project_ids:
        sprint_rows = db.scalars(
            select(Sprint).where(
                Sprint.project_id.in_(project_ids),
                Sprint.deleted_at.is_(None),
                Sprint.status == "active",
            )
        ).all()
        for sp in sprint_rows:
            if sp.project_id:
                active_sprint_map[sp.project_id] = sp.name

    portfolio: list[ProjectPortfolioRow] = []
    for project in projects:
        total, done, overdue = project_stats.get(project.id, (0, 0, 0))
        pct = round((done / total) * 100) if total else 0
        health = "at_risk" if overdue > 0 or (total > 5 and pct < 40) else "healthy"
        portfolio.append(
            ProjectPortfolioRow(
                project_id=project.id,
                name=project.name,
                color=project.color,
                progress_percent=pct,
                active_sprint=active_sprint_map.get(project.id),
                task_count=total,
                overdue_count=overdue,
                health=health,
            )
        )

    project_progress_total = len(project_progress)

    return OrgDashboardOut(
        organization_id=org.id,
        organization_name=org.name,
        kpis=kpis,
        project_progress=project_progress,
        project_progress_total=project_progress_total,
        task_status_total=task_total,
        task_status_breakdown=task_status_breakdown,
        team_workload=team_workload,
        team_workload_total=team_workload_total,
        team_productivity=team_productivity,
        team_productivity_total=team_productivity_total,
        team_productivity_series=prod_series,
        team_productivity_trend=prod_trend,
        team_productivity_summary=prod_summary,
        delivery_velocity_trend=velocity_trend,
        delivery_velocity_summary=velocity_summary,
        critical_tasks=critical,
        critical_tasks_total=int(critical_tasks_total),
        recent_activities=recent,
        project_portfolio=portfolio,
    )


# ===================================================================
# Shared helpers for scoped dashboards
# ===================================================================


def _task_counts(db: Session, project_ids: list[uuid.UUID], today: date):
    """Return (total_open, done, overdue) across multiple projects."""
    if not project_ids:
        return 0, 0, 0
    total_open = db.scalar(select(func.count(Task.id)).where(*_open_task_filter(project_ids))) or 0
    done = db.scalar(
        select(func.count(Task.id)).where(
            Task.project_id.in_(project_ids),
            Task.deleted_at.is_(None),
            Task.is_archived.is_(False),
            Task.parent_task_id.is_(None),
            Task.completed_at.is_not(None),
        )
    ) or 0
    overdue = db.scalar(
        select(func.count(Task.id)).where(
            *_open_task_filter(project_ids),
            Task.due_date.is_not(None),
            Task.due_date < today,
        )
    ) or 0
    return int(total_open), int(done), int(overdue)


def _completed_in_window(
    db: Session,
    project_ids: list[uuid.UUID],
    start_dt: datetime,
    end_dt: datetime | None = None,
) -> int:
    """Tasks completed in [start_dt, end_dt) across the given projects."""
    if not project_ids:
        return 0
    conds = [
        Task.project_id.in_(project_ids),
        Task.deleted_at.is_(None),
        Task.completed_at.is_not(None),
        Task.completed_at >= start_dt,
    ]
    if end_dt is not None:
        conds.append(Task.completed_at < end_dt)
    return int(db.scalar(select(func.count(Task.id)).where(*conds)) or 0)


def _team_completed_by_day(
    db: Session,
    team_ids: list[uuid.UUID],
    project_ids: list[uuid.UUID],
    start_dt: datetime,
    end_dt: datetime,
) -> dict[tuple[uuid.UUID, date], int]:
    """Completed tasks per team per calendar day (assignee is a team member)."""
    if not team_ids or not project_ids:
        return {}
    day_col = func.date(Task.completed_at)
    rows = db.execute(
        select(Team.id, day_col, func.count(func.distinct(Task.id)))
        .select_from(Task)
        .join(TaskAssignee, TaskAssignee.task_id == Task.id)
        .join(TeamMember, TeamMember.user_id == TaskAssignee.user_id)
        .join(Team, Team.id == TeamMember.team_id)
        .where(
            Team.id.in_(team_ids),
            Task.project_id.in_(project_ids),
            Task.deleted_at.is_(None),
            Task.completed_at.is_not(None),
            Task.completed_at >= start_dt,
            Task.completed_at < end_dt,
        )
        .group_by(Team.id, day_col)
    ).all()
    out: dict[tuple[uuid.UUID, date], int] = {}
    for team_id, day_value, count in rows:
        if day_value is None:
            continue
        day = day_value if isinstance(day_value, date) else day_value
        out[(team_id, day)] = int(count)
    return out


def _build_team_productivity_chart(
    db: Session,
    teams: list[Team],
    project_ids: list[uuid.UUID],
    today: date,
) -> tuple[list[TeamProductivitySeries], list[TeamProductivityTrendPoint], TeamProductivitySummary]:
    if not teams or not project_ids:
        return [], [], TeamProductivitySummary()

    if len(teams) > TEAM_PRODUCTIVITY_WORKSPACE_ROLLUP_THRESHOLD:
        return _build_workspace_productivity_chart(db, teams, project_ids, today)

    return _build_team_level_productivity_chart(db, teams, project_ids, today)


def _productivity_chart_window(today: date) -> tuple[date, datetime, datetime, datetime]:
    chart_start = today - timedelta(days=TEAM_PRODUCTIVITY_CHART_DAYS - 1)
    chart_end = today + timedelta(days=1)
    start_dt = datetime.combine(chart_start, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(chart_end, datetime.min.time(), tzinfo=timezone.utc)
    prev_start = chart_start - timedelta(days=TEAM_PRODUCTIVITY_CHART_DAYS)
    prev_start_dt = datetime.combine(prev_start, datetime.min.time(), tzinfo=timezone.utc)
    return chart_start, start_dt, end_dt, prev_start_dt


def _build_team_level_productivity_chart(
    db: Session,
    teams: list[Team],
    project_ids: list[uuid.UUID],
    today: date,
) -> tuple[list[TeamProductivitySeries], list[TeamProductivityTrendPoint], TeamProductivitySummary]:
    chart_start, start_dt, end_dt, prev_start_dt = _productivity_chart_window(today)

    team_ids = [team.id for team in teams]
    counts_by_day = _team_completed_by_day(db, team_ids, project_ids, start_dt, end_dt)
    prev_counts_by_day = _team_completed_by_day(
        db, team_ids, project_ids, prev_start_dt, start_dt
    )

    totals: dict[uuid.UUID, int] = {tid: 0 for tid in team_ids}
    for (team_id, _day), count in counts_by_day.items():
        totals[team_id] = totals.get(team_id, 0) + count

    ranked = sorted(teams, key=lambda t: totals.get(t.id, 0), reverse=True)
    featured = ranked[:TEAM_PRODUCTIVITY_CHART_TOP_N]
    featured_ids = {team.id for team in featured}
    other_count = max(0, len(ranked) - len(featured))

    series: list[TeamProductivitySeries] = [
        TeamProductivitySeries(
            key=str(team.id),
            team_id=team.id,
            name=team.name,
            color=team.color or "#14b8a6",
        )
        for team in featured
    ]
    if other_count > 0:
        series.append(
            TeamProductivitySeries(
                key=OTHER_TEAM_CHART_KEY,
                team_id=None,
                name=f"Other teams ({other_count})",
                color=OTHER_TEAM_COLOR,
            )
        )

    trend = _productivity_trend_points(chart_start, today, teams, featured_ids, counts_by_day)

    total_completed = sum(counts_by_day.values())
    previous_period_total = sum(prev_counts_by_day.values())
    active_teams = sum(1 for total in totals.values() if total > 0)
    leader = max(ranked, key=lambda t: totals.get(t.id, 0)) if ranked else None
    leading_count = totals.get(leader.id, 0) if leader else 0

    summary = TeamProductivitySummary(
        total_completed=total_completed,
        previous_period_total=previous_period_total,
        active_teams=active_teams,
        leading_team_name=leader.name if leader and leading_count > 0 else None,
        leading_team_count=leading_count,
        display_mode="team",
        total_teams=len(teams),
        total_entities=len(teams),
        featured_count=len(featured),
        other_entities_count=other_count,
    )
    return series, trend, summary


def _build_workspace_productivity_chart(
    db: Session,
    teams: list[Team],
    project_ids: list[uuid.UUID],
    today: date,
) -> tuple[list[TeamProductivitySeries], list[TeamProductivityTrendPoint], TeamProductivitySummary]:
    from app.models.workspace import Workspace

    chart_start, start_dt, end_dt, prev_start_dt = _productivity_chart_window(today)

    team_ids = [team.id for team in teams]
    team_to_workspace = {team.id: team.workspace_id for team in teams}
    counts_by_day = _team_completed_by_day(db, team_ids, project_ids, start_dt, end_dt)
    prev_counts_by_day = _team_completed_by_day(
        db, team_ids, project_ids, prev_start_dt, start_dt
    )

    workspace_day_counts: dict[tuple[uuid.UUID, date], int] = {}
    for (team_id, day), count in counts_by_day.items():
        ws_id = team_to_workspace[team_id]
        key = (ws_id, day)
        workspace_day_counts[key] = workspace_day_counts.get(key, 0) + count

    workspace_totals: dict[uuid.UUID, int] = {}
    for (ws_id, _day), count in workspace_day_counts.items():
        workspace_totals[ws_id] = workspace_totals.get(ws_id, 0) + count

    workspace_ids = list(workspace_totals.keys())
    workspaces = {
        ws.id: ws
        for ws in db.scalars(select(Workspace).where(Workspace.id.in_(workspace_ids))).all()
    }
    ranked_ws_ids = sorted(workspace_ids, key=lambda wid: workspace_totals.get(wid, 0), reverse=True)
    featured_ws = ranked_ws_ids[:TEAM_PRODUCTIVITY_CHART_TOP_N]
    featured_ws_set = set(featured_ws)
    other_ws_count = max(0, len(ranked_ws_ids) - len(featured_ws))

    series: list[TeamProductivitySeries] = []
    for ws_id in featured_ws:
        ws = workspaces.get(ws_id)
        series.append(
            TeamProductivitySeries(
                key=f"ws-{ws_id}",
                team_id=None,
                name=ws.name if ws else "Workspace",
                color=ws.color if ws else "#14b8a6",
            )
        )
    if other_ws_count > 0:
        series.append(
            TeamProductivitySeries(
                key=OTHER_TEAM_CHART_KEY,
                team_id=None,
                name=f"Other workspaces ({other_ws_count})",
                color=OTHER_TEAM_COLOR,
            )
        )

    trend: list[TeamProductivityTrendPoint] = []
    day_cursor = chart_start
    while day_cursor <= today:
        counts: dict[str, int] = {}
        other_total = 0
        for ws_id in ranked_ws_ids:
            count = workspace_day_counts.get((ws_id, day_cursor), 0)
            if ws_id in featured_ws_set:
                counts[f"ws-{ws_id}"] = count
            else:
                other_total += count
        if other_ws_count > 0:
            counts[OTHER_TEAM_CHART_KEY] = other_total
        trend.append(
            TeamProductivityTrendPoint(
                day=day_cursor,
                label=f"{day_cursor.strftime('%b')} {day_cursor.day}",
                counts=counts,
            )
        )
        day_cursor += timedelta(days=1)

    total_completed = sum(counts_by_day.values())
    previous_period_total = sum(prev_counts_by_day.values())
    teams_with_completions = {team_id for (team_id, _day) in counts_by_day}
    active_teams = len(teams_with_completions)

    leader_ws_id = ranked_ws_ids[0] if ranked_ws_ids and workspace_totals.get(ranked_ws_ids[0], 0) > 0 else None
    leader_ws = workspaces.get(leader_ws_id) if leader_ws_id else None
    leading_count = workspace_totals.get(leader_ws_id, 0) if leader_ws_id else 0

    summary = TeamProductivitySummary(
        total_completed=total_completed,
        previous_period_total=previous_period_total,
        active_teams=active_teams,
        leading_team_name=leader_ws.name if leader_ws and leading_count > 0 else None,
        leading_team_count=leading_count,
        display_mode="workspace",
        total_teams=len(teams),
        total_entities=len({t.workspace_id for t in teams}),
        featured_count=len(featured_ws),
        other_entities_count=other_ws_count,
    )
    return series, trend, summary


def _productivity_trend_points(
    chart_start: date,
    today: date,
    teams: list[Team],
    featured_ids: set[uuid.UUID],
    counts_by_day: dict[tuple[uuid.UUID, date], int],
) -> list[TeamProductivityTrendPoint]:
    other_count = max(0, len(teams) - len(featured_ids))
    trend: list[TeamProductivityTrendPoint] = []
    day_cursor = chart_start
    while day_cursor <= today:
        counts: dict[str, int] = {}
        other_total = 0
        for team in teams:
            count = counts_by_day.get((team.id, day_cursor), 0)
            if team.id in featured_ids:
                counts[str(team.id)] = count
            else:
                other_total += count
        if other_count > 0:
            counts[OTHER_TEAM_CHART_KEY] = other_total
        trend.append(
            TeamProductivityTrendPoint(
                day=day_cursor,
                label=f"{day_cursor.strftime('%b')} {day_cursor.day}",
                counts=counts,
            )
        )
        day_cursor += timedelta(days=1)
    return trend


def _org_completed_by_day(
    db: Session,
    project_ids: list[uuid.UUID],
    start_dt: datetime,
    end_dt: datetime,
) -> dict[date, int]:
    """Distinct tasks completed per calendar day across the org's projects."""
    if not project_ids:
        return {}
    day_col = func.date(Task.completed_at)
    rows = db.execute(
        select(day_col, func.count(Task.id))
        .where(
            Task.project_id.in_(project_ids),
            Task.deleted_at.is_(None),
            Task.is_archived.is_(False),
            Task.parent_task_id.is_(None),
            Task.completed_at.is_not(None),
            Task.completed_at >= start_dt,
            Task.completed_at < end_dt,
        )
        .group_by(day_col)
    ).all()
    out: dict[date, int] = {}
    for day_value, count in rows:
        if day_value is None:
            continue
        day = day_value if isinstance(day_value, date) else day_value
        out[day] = int(count)
    return out


def _build_delivery_velocity(
    db: Session,
    project_ids: list[uuid.UUID],
    today: date,
) -> tuple[list[DeliveryVelocityTrendPoint], DeliveryVelocitySummary]:
    chart_days = TEAM_PRODUCTIVITY_CHART_DAYS
    if not project_ids:
        return [], DeliveryVelocitySummary()

    chart_start = today - timedelta(days=chart_days - 1)
    chart_end = today + timedelta(days=1)
    start_dt = datetime.combine(chart_start, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(chart_end, datetime.min.time(), tzinfo=timezone.utc)

    prev_start = chart_start - timedelta(days=chart_days)
    prev_start_dt = datetime.combine(prev_start, datetime.min.time(), tzinfo=timezone.utc)

    counts_by_day = _org_completed_by_day(db, project_ids, start_dt, end_dt)
    prev_counts_by_day = _org_completed_by_day(db, project_ids, prev_start_dt, start_dt)

    trend: list[DeliveryVelocityTrendPoint] = []
    day_cursor = chart_start
    while day_cursor <= today:
        count = counts_by_day.get(day_cursor, 0)
        trend.append(
            DeliveryVelocityTrendPoint(
                day=day_cursor,
                label=f"{day_cursor.strftime('%b')} {day_cursor.day}",
                completed_count=count,
            )
        )
        day_cursor += timedelta(days=1)

    total_completed = sum(counts_by_day.values())
    previous_period_total = sum(prev_counts_by_day.values())
    daily_average = round(total_completed / chart_days) if chart_days else 0

    best_day_label: str | None = None
    best_day_count = 0
    if trend:
        peak = max(trend, key=lambda p: p.completed_count)
        if peak.completed_count > 0:
            best_day_label = peak.label
            best_day_count = peak.completed_count

    summary = DeliveryVelocitySummary(
        total_completed=total_completed,
        previous_period_total=previous_period_total,
        daily_average=daily_average,
        best_day_label=best_day_label,
        best_day_count=best_day_count,
    )
    return trend, summary


def _status_breakdown(db: Session, project_ids: list[uuid.UUID]):
    if not project_ids:
        return [], 0
    rows = db.execute(
        select(CustomStatus.name, CustomStatus.color, func.count(Task.id))
        .join(Task, Task.status_id == CustomStatus.id)
        .where(*_open_task_filter(project_ids))
        .group_by(CustomStatus.name, CustomStatus.color)
        .order_by(func.count(Task.id).desc())
    ).all()
    breakdown = [StatusCount(name=r[0], color=r[1], count=r[2]) for r in rows]
    return breakdown, sum(s.count for s in breakdown)


def _member_workload(
    db: Session, project_ids: list[uuid.UUID], member_user_ids: list[uuid.UUID], week_ago: date
) -> list[MemberWorkloadRow]:
    if not project_ids or not member_user_ids:
        return []
    week_ago_dt = datetime.combine(week_ago, datetime.min.time(), tzinfo=timezone.utc)
    rows: list[MemberWorkloadRow] = []
    briefs = user_briefs(db, member_user_ids)
    for uid in member_user_ids:
        brief = briefs.get(uid)
        if not brief:
            continue
        open_count = db.scalar(
            select(func.count(Task.id.distinct()))
            .join(TaskAssignee, TaskAssignee.task_id == Task.id)
            .where(*_open_task_filter(project_ids), TaskAssignee.user_id == uid)
        ) or 0
        done_count = db.scalar(
            select(func.count(Task.id.distinct()))
            .join(TaskAssignee, TaskAssignee.task_id == Task.id)
            .where(
                Task.project_id.in_(project_ids),
                Task.deleted_at.is_(None),
                Task.completed_at.is_not(None),
                Task.completed_at >= week_ago_dt,
                TaskAssignee.user_id == uid,
            )
        ) or 0
        rows.append(MemberWorkloadRow(user=brief, open_tasks=int(open_count), completed_tasks=int(done_count)))
    rows.sort(key=lambda r: r.open_tasks, reverse=True)
    return rows


def _critical_tasks_for_projects(
    db: Session, project_ids: list[uuid.UUID], projects: list[Project], today: date
) -> tuple[list[CriticalTaskRow], int]:
    if not project_ids:
        return [], 0
    crit_total = db.scalar(
        select(func.count(Task.id))
        .join(Project, Project.id == Task.project_id)
        .outerjoin(CustomStatus, CustomStatus.id == Task.status_id)
        .where(*_open_task_filter(project_ids), _critical_task_condition(today))
    ) or 0
    crit_tasks = db.scalars(
        select(Task)
        .join(Project, Project.id == Task.project_id)
        .outerjoin(CustomStatus, CustomStatus.id == Task.status_id)
        .where(*_open_task_filter(project_ids), _critical_task_condition(today))
        .order_by(*_critical_task_order(today))
        .limit(CRITICAL_TASKS_LIMIT)
    ).all()
    project_map = {p.id: p for p in projects}
    task_ids = [t.id for t in crit_tasks]
    assignee_by_task: dict[uuid.UUID, uuid.UUID] = {}
    if task_ids:
        for tid, uid in db.execute(
            select(TaskAssignee.task_id, TaskAssignee.user_id).where(TaskAssignee.task_id.in_(task_ids))
        ).all():
            assignee_by_task.setdefault(tid, uid)
    briefs = user_briefs(db, list(set(assignee_by_task.values())))
    status_ids = {t.status_id for t in crit_tasks if t.status_id}
    status_map: dict[uuid.UUID, CustomStatus] = {}
    if status_ids:
        status_map = {s.id: s for s in db.scalars(select(CustomStatus).where(CustomStatus.id.in_(status_ids))).all()}
    result: list[CriticalTaskRow] = []
    for task in crit_tasks:
        proj = project_map.get(task.project_id)
        if not proj:
            continue
        status = status_map.get(task.status_id) if task.status_id else None
        aid = assignee_by_task.get(task.id)
        result.append(
            CriticalTaskRow(
                task_id=task.id,
                title=task.title,
                project_id=proj.id,
                project_name=proj.name,
                task_ref=format_task_ref(proj.id, task.number),
                assignee=briefs.get(aid) if aid else None,
                due_date=task.due_date,
                status_name=status.name if status else "No status",
                status_color=status.color if status else "#87909E",
                status_kind=_critical_kind(task, status, today),
            )
        )
    return result, int(crit_total)


def _assigned_task_ids_subquery(user_id: uuid.UUID):
    return select(TaskAssignee.task_id).where(TaskAssignee.user_id == user_id)


def _status_breakdown_for_assignee(
    db: Session, project_ids: list[uuid.UUID], user_id: uuid.UUID
) -> tuple[list[StatusCount], int]:
    if not project_ids:
        return [], 0
    rows = db.execute(
        select(CustomStatus.name, CustomStatus.color, func.count(Task.id))
        .join(Task, Task.status_id == CustomStatus.id)
        .where(*_open_task_filter(project_ids), Task.id.in_(_assigned_task_ids_subquery(user_id)))
        .group_by(CustomStatus.name, CustomStatus.color)
        .order_by(func.count(Task.id).desc())
    ).all()
    breakdown = [StatusCount(name=r[0], color=r[1], count=r[2]) for r in rows]
    return breakdown, sum(s.count for s in breakdown)


def _critical_tasks_for_assignee(
    db: Session,
    project_ids: list[uuid.UUID],
    projects: list[Project],
    today: date,
    user_id: uuid.UUID,
) -> tuple[list[CriticalTaskRow], int]:
    if not project_ids:
        return [], 0
    base = [
        *_open_task_filter(project_ids),
        Task.id.in_(_assigned_task_ids_subquery(user_id)),
        _critical_task_condition(today),
    ]
    crit_total = db.scalar(
        select(func.count(Task.id))
        .outerjoin(CustomStatus, CustomStatus.id == Task.status_id)
        .where(*base)
    ) or 0
    crit_tasks = db.scalars(
        select(Task)
        .outerjoin(CustomStatus, CustomStatus.id == Task.status_id)
        .where(*base)
        .order_by(*_critical_task_order(today))
        .limit(CRITICAL_TASKS_LIMIT)
    ).all()
    project_map = {p.id: p for p in projects}
    status_ids = {t.status_id for t in crit_tasks if t.status_id}
    status_map: dict[uuid.UUID, CustomStatus] = {}
    if status_ids:
        status_map = {s.id: s for s in db.scalars(select(CustomStatus).where(CustomStatus.id.in_(status_ids))).all()}
    result: list[CriticalTaskRow] = []
    for task in crit_tasks:
        proj = project_map.get(task.project_id)
        if not proj:
            continue
        status = status_map.get(task.status_id) if task.status_id else None
        result.append(
            CriticalTaskRow(
                task_id=task.id,
                title=task.title,
                project_id=proj.id,
                project_name=proj.name,
                task_ref=format_task_ref(proj.id, task.number),
                assignee=None,
                due_date=task.due_date,
                status_name=status.name if status else "No status",
                status_color=status.color if status else "#87909E",
                status_kind=_critical_kind(task, status, today),
            )
        )
    return result, int(crit_total)


def _recent_activities_for_project(
    db: Session,
    project_id: uuid.UUID,
    workspace_id: uuid.UUID,
    project_name: str,
    period_start: date,
    actor_id: uuid.UUID | None = None,
) -> list[DashboardActivityRow]:
    period_start_dt = datetime.combine(period_start, datetime.min.time(), tzinfo=timezone.utc)
    conditions = [
        ActivityLog.workspace_id == workspace_id,
        ActivityLog.project_id == project_id,
        ActivityLog.created_at >= period_start_dt,
    ]
    # Non-org-leader dashboards only surface the viewer's own activity.
    if actor_id is not None:
        conditions.append(ActivityLog.actor_id == actor_id)
    logs = db.scalars(
        select(ActivityLog)
        .where(*conditions)
        .order_by(ActivityLog.created_at.desc())
        .limit(RECENT_ACTIVITY_LIMIT)
    ).all()
    actor_ids = [log.actor_id for log in logs if log.actor_id]
    briefs = user_briefs(db, actor_ids)
    return [
        DashboardActivityRow(
            id=log.id,
            action=log.action,
            summary=_activity_summary(log.action, log.data or {}),
            actor=briefs.get(log.actor_id) if log.actor_id else None,
            project_name=project_name,
            created_at=log.created_at,
        )
        for log in logs
    ]


def _recent_activities(
    db: Session,
    workspace_ids: list[uuid.UUID],
    project_map: dict[uuid.UUID, str],
    period_start: date,
    actor_id: uuid.UUID | None = None,
    project_ids: list[uuid.UUID] | None = None,
) -> list[DashboardActivityRow]:
    if not workspace_ids:
        return []
    period_start_dt = datetime.combine(period_start, datetime.min.time(), tzinfo=timezone.utc)
    conditions = [
        ActivityLog.workspace_id.in_(workspace_ids),
        ActivityLog.created_at >= period_start_dt,
    ]
    # Scoped dashboards (e.g. a space) must not surface activity from sibling
    # projects elsewhere in the workspace.
    if project_ids is not None:
        if not project_ids:
            return []
        conditions.append(ActivityLog.project_id.in_(project_ids))
    # Non-org-leader dashboards only surface the viewer's own activity.
    if actor_id is not None:
        conditions.append(ActivityLog.actor_id == actor_id)
    logs = db.scalars(
        select(ActivityLog)
        .where(*conditions)
        .order_by(ActivityLog.created_at.desc())
        .limit(RECENT_ACTIVITY_LIMIT)
    ).all()
    actor_ids = [log.actor_id for log in logs if log.actor_id]
    briefs = user_briefs(db, actor_ids)
    return [
        DashboardActivityRow(
            id=log.id,
            action=log.action,
            summary=_activity_summary(log.action, log.data or {}),
            actor=briefs.get(log.actor_id) if log.actor_id else None,
            project_name=project_map.get(log.project_id) if log.project_id else None,
            created_at=log.created_at,
        )
        for log in logs
    ]


def _sprint_task_counts(db: Session, sprint_id: uuid.UUID) -> tuple[int, int]:
    """Live sprint task totals: (total_tasks, completed_tasks)."""
    rows = db.execute(
        select(Task.completed_at)
        .join(SprintTask, SprintTask.task_id == Task.id)
        .where(SprintTask.sprint_id == sprint_id, Task.deleted_at.is_(None))
    ).all()
    total = len(rows)
    completed = sum(1 for row in rows if row[0] is not None)
    return total, completed


def _sprint_point_totals(db: Session, sprint_id: uuid.UUID) -> tuple[int, int]:
    """Story-point rollup for dashboards that still show velocity-style metrics."""
    rows = db.execute(
        select(Task.story_points, Task.completed_at)
        .join(SprintTask, SprintTask.task_id == Task.id)
        .where(SprintTask.sprint_id == sprint_id, Task.deleted_at.is_(None))
    ).all()
    total = sum(r[0] or 0 for r in rows)
    completed = sum(r[0] or 0 for r in rows if r[1] is not None)
    return total, completed


def _sprint_summaries(db: Session, workspace_id: uuid.UUID, project_ids: list[uuid.UUID]) -> list[SprintSummaryRow]:
    if not project_ids:
        return []
    sprints = db.scalars(
        select(Sprint).where(
            Sprint.workspace_id == workspace_id,
            Sprint.deleted_at.is_(None),
            Sprint.status == "active",
            or_(Sprint.project_id.is_(None), Sprint.project_id.in_(project_ids)),
        ).order_by(Sprint.started_at.desc().nulls_last())
    ).all()
    rows: list[SprintSummaryRow] = []
    for s in sprints:
        task_count, completed_tasks = _sprint_task_counts(db, s.id)
        total_points, completed_points = _sprint_point_totals(db, s.id)
        rows.append(
            SprintSummaryRow(
                sprint_id=s.id,
                name=s.name,
                status=s.status,
                task_count=task_count,
                completed_tasks=completed_tasks,
                total_points=total_points,
                completed_points=completed_points,
                start_date=s.start_date,
                end_date=s.end_date,
            )
        )
    return rows


# ===================================================================
# Workspace Admin Dashboard
# ===================================================================


def build_workspace_dashboard(
    db: Session, perms: PermissionService, workspace_id: uuid.UUID
) -> WorkspaceDashboardOut:
    ws = perms.require_workspace_member(workspace_id)
    today = _today()
    week_ago = today - timedelta(days=7)
    period_start = today - timedelta(days=7)

    spaces = list(db.scalars(
        select(Space).where(Space.workspace_id == workspace_id, Space.deleted_at.is_(None)).order_by(Space.position)
    ).all())

    projects = list(db.scalars(
        select(Project).where(
            Project.workspace_id == workspace_id, Project.deleted_at.is_(None), Project.is_archived.is_(False)
        ).order_by(Project.name)
    ).all())
    project_ids = [p.id for p in projects]

    total_open, done, overdue = _task_counts(db, project_ids, today)
    total_tasks = total_open + done
    completion_pct = round((done / total_tasks) * 100) if total_tasks else 0

    # Week-over-week trends
    week_ago_dt = datetime.combine(week_ago, datetime.min.time(), tzinfo=timezone.utc)
    done_this_week = _completed_in_window(db, project_ids, week_ago_dt)
    done_prev_week = _completed_in_window(db, project_ids, week_ago_dt - timedelta(days=7), week_ago_dt)
    overdue_last_week = 0
    if project_ids:
        overdue_last_week = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter(project_ids), Task.due_date.is_not(None), Task.due_date < week_ago,
            )
        ) or 0

    member_ids = list(db.scalars(
        select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)
    ).all())
    member_count = len(member_ids)

    active_sprint_count = db.scalar(
        select(func.count(Sprint.id)).where(
            Sprint.workspace_id == workspace_id, Sprint.deleted_at.is_(None), Sprint.status == "active",
        )
    ) or 0

    kpis = WorkspaceDashboardKpis(
        total_tasks=total_tasks,
        open_tasks=total_open,
        completed_tasks=done,
        overdue_tasks=overdue,
        completion_percent=completion_pct,
        spaces=len(spaces),
        projects=len(projects),
        members=member_count,
        active_sprints=int(active_sprint_count),
        trends={
            "completed_tasks": _trend(done_this_week - done_prev_week, unit="last week"),
            "overdue_tasks": _trend(overdue - int(overdue_last_week), unit="last week", positive_is_good=False),
        },
    )

    space_overview: list[SpaceOverviewRow] = []
    for space in spaces:
        s_projects = [p for p in projects if p.space_id == space.id]
        s_project_ids = [p.id for p in s_projects]
        s_open, s_done, _ = _task_counts(db, s_project_ids, today) if s_project_ids else (0, 0, 0)
        space_overview.append(SpaceOverviewRow(
            space_id=space.id, name=space.name, color=space.color,
            project_count=len(s_projects), task_count=s_open + s_done, done_count=s_done,
        ))

    breakdown, status_total = _status_breakdown(db, project_ids)

    proj_progress: list[ProjectProgressRow] = []
    for p in projects:
        p_open, p_done, _ = _task_counts(db, [p.id], today)
        p_total = p_open + p_done
        proj_progress.append(ProjectProgressRow(
            project_id=p.id, name=p.name, color=p.color,
            progress_percent=round((p_done / p_total) * 100) if p_total else 0,
        ))
    proj_progress.sort(key=lambda r: r.progress_percent, reverse=True)

    workload = _member_workload(db, project_ids, member_ids, week_ago)
    sprints = _sprint_summaries(db, workspace_id, project_ids)
    critical, crit_total = _critical_tasks_for_projects(db, project_ids, projects, today)
    proj_names = {p.id: p.name for p in projects}
    # A workspace admin sees only their own activity (org leaders use the org dashboard).
    activities = _recent_activities(db, [workspace_id], proj_names, period_start, actor_id=perms.user.id)

    return WorkspaceDashboardOut(
        workspace_id=ws.id,
        workspace_name=ws.name,
        kpis=kpis,
        space_overview=space_overview,
        task_status_breakdown=breakdown,
        task_status_total=status_total,
        project_progress=proj_progress,
        project_progress_total=len(proj_progress),
        member_workload=workload,
        active_sprints=sprints,
        critical_tasks=critical,
        critical_tasks_total=crit_total,
        recent_activities=activities,
    )


# ===================================================================
# Space Admin Dashboard
# ===================================================================


def build_space_dashboard(
    db: Session, perms: PermissionService, space_id: uuid.UUID
) -> SpaceDashboardOut:
    space = perms.require_space_member(space_id)
    ws = perms.get_workspace_or_404(space.workspace_id)
    today = _today()
    week_ago = today - timedelta(days=7)
    period_start = today - timedelta(days=7)

    projects = list(db.scalars(
        select(Project).where(
            Project.space_id == space_id, Project.deleted_at.is_(None), Project.is_archived.is_(False),
        ).order_by(Project.name)
    ).all())
    project_ids = [p.id for p in projects]

    total_open, done, overdue = _task_counts(db, project_ids, today)
    total_tasks = total_open + done
    completion_pct = round((done / total_tasks) * 100) if total_tasks else 0

    week_ago_dt = datetime.combine(week_ago, datetime.min.time(), tzinfo=timezone.utc)
    done_this_week = _completed_in_window(db, project_ids, week_ago_dt)
    done_prev_week = _completed_in_window(db, project_ids, week_ago_dt - timedelta(days=7), week_ago_dt)
    overdue_last_week = 0
    if project_ids:
        overdue_last_week = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter(project_ids), Task.due_date.is_not(None), Task.due_date < week_ago,
            )
        ) or 0

    kpis = SpaceDashboardKpis(
        total_tasks=total_tasks,
        open_tasks=total_open,
        completed_tasks=done,
        overdue_tasks=overdue,
        completion_percent=completion_pct,
        projects=len(projects),
        members=db.scalar(
            select(func.count(SpaceMember.user_id)).where(SpaceMember.space_id == space_id)
        ) or 0,
        trends={
            "completed_tasks": _trend(done_this_week - done_prev_week, unit="last week"),
            "overdue_tasks": _trend(overdue - int(overdue_last_week), unit="last week", positive_is_good=False),
        },
    )

    proj_progress: list[ProjectProgressRow] = []
    for p in projects:
        p_open, p_done, _ = _task_counts(db, [p.id], today)
        p_total = p_open + p_done
        proj_progress.append(ProjectProgressRow(
            project_id=p.id, name=p.name, color=p.color,
            progress_percent=round((p_done / p_total) * 100) if p_total else 0,
        ))
    proj_progress.sort(key=lambda r: r.progress_percent, reverse=True)

    breakdown, status_total = _status_breakdown(db, project_ids)

    # Gather unique assignees across all space projects
    assignee_ids: list[uuid.UUID] = []
    if project_ids:
        assignee_ids = list(db.scalars(
            select(TaskAssignee.user_id.distinct())
            .join(Task, Task.id == TaskAssignee.task_id)
            .where(Task.project_id.in_(project_ids), Task.deleted_at.is_(None))
        ).all())
    workload = _member_workload(db, project_ids, assignee_ids, week_ago)
    critical, crit_total = _critical_tasks_for_projects(db, project_ids, projects, today)
    proj_names = {p.id: p.name for p in projects}
    activities = _recent_activities(
        db, [space.workspace_id], proj_names, period_start, actor_id=perms.user.id, project_ids=project_ids
    )

    return SpaceDashboardOut(
        space_id=space.id,
        space_name=space.name,
        workspace_name=ws.name,
        kpis=kpis,
        project_progress=proj_progress,
        project_progress_total=len(proj_progress),
        task_status_breakdown=breakdown,
        task_status_total=status_total,
        member_workload=workload,
        critical_tasks=critical,
        critical_tasks_total=crit_total,
        recent_activities=activities,
    )


# ===================================================================
# Project Admin Dashboard
# ===================================================================


def build_project_dashboard(
    db: Session, perms: PermissionService, project_id: uuid.UUID
) -> ProjectDashboardOut:
    project = perms.require_project_view(project_id)
    ws = perms.get_workspace_or_404(project.workspace_id)
    space = db.get(Space, project.space_id) if project.space_id else None
    today = _today()
    week_ago = today - timedelta(days=7)
    period_start = today - timedelta(days=7)

    total_open, done, overdue = _task_counts(db, [project_id], today)
    total_tasks = total_open + done
    completion_pct = round((done / total_tasks) * 100) if total_tasks else 0

    week_ago_dt = datetime.combine(week_ago, datetime.min.time(), tzinfo=timezone.utc)
    done_this_week = _completed_in_window(db, [project_id], week_ago_dt)
    done_prev_week = _completed_in_window(db, [project_id], week_ago_dt - timedelta(days=7), week_ago_dt)
    overdue_last_week = db.scalar(
        select(func.count(Task.id)).where(
            *_open_task_filter([project_id]), Task.due_date.is_not(None), Task.due_date < week_ago,
        )
    ) or 0

    # Sprint velocity: completed points in last 3 completed sprints
    velocity = 0
    completed_sprints = db.scalars(
        select(Sprint).where(
            Sprint.workspace_id == project.workspace_id,
            Sprint.deleted_at.is_(None),
            Sprint.status == "completed",
            or_(Sprint.project_id.is_(None), Sprint.project_id == project_id),
        ).order_by(Sprint.completed_at.desc().nulls_last()).limit(3)
    ).all()
    if completed_sprints:
        total_pts = sum(_sprint_point_totals(db, s.id)[1] for s in completed_sprints)
        velocity = round(total_pts / len(completed_sprints))

    kpis = ProjectDashboardKpis(
        total_tasks=total_tasks,
        open_tasks=total_open,
        completed_tasks=done,
        overdue_tasks=overdue,
        completion_percent=completion_pct,
        sprint_velocity=velocity,
        projects=1,
        members=db.scalar(
            select(func.count(ProjectMember.user_id)).where(ProjectMember.project_id == project_id)
        ) or 0,
        trends={
            "completed_tasks": _trend(done_this_week - done_prev_week, unit="last week"),
            "overdue_tasks": _trend(overdue - int(overdue_last_week), unit="last week", positive_is_good=False),
        },
    )

    breakdown, status_total = _status_breakdown(db, [project_id])

    assignee_ids = list(db.scalars(
        select(TaskAssignee.user_id.distinct())
        .join(Task, Task.id == TaskAssignee.task_id)
        .where(Task.project_id == project_id, Task.deleted_at.is_(None))
    ).all())
    workload = _member_workload(db, [project_id], assignee_ids, week_ago)

    sprints = _sprint_summaries(db, project.workspace_id, [project_id])
    critical, crit_total = _critical_tasks_for_projects(db, [project_id], [project], today)
    activities = _recent_activities_for_project(
        db, project.id, project.workspace_id, project.name, period_start, actor_id=perms.user.id
    )

    return ProjectDashboardOut(
        project_id=project.id,
        project_name=project.name,
        project_color=project.color,
        space_name=space.name if space else None,
        kpis=kpis,
        task_status_breakdown=breakdown,
        task_status_total=status_total,
        member_workload=workload,
        active_sprints=sprints,
        critical_tasks=critical,
        critical_tasks_total=crit_total,
        recent_activities=activities,
    )


# ===================================================================
# Project Member Dashboard
# ===================================================================


def build_project_member_dashboard(
    db: Session, perms: PermissionService, project_id: uuid.UUID
) -> ProjectMemberDashboardOut:
    project = perms.require_project_view(project_id)
    space = db.get(Space, project.space_id) if project.space_id else None
    user_id = perms.user.id
    today = _today()
    week_ago = today - timedelta(days=7)
    period_start = today - timedelta(days=7)
    week_end = today + timedelta(days=7)

    my_role = perms.project_role(project_id) or "member"
    is_viewer = my_role == "viewer"
    week_ago_dt = datetime.combine(week_ago, datetime.min.time(), tzinfo=timezone.utc)

    if is_viewer:
        total_open, done, _proj_overdue = _task_counts(db, [project_id], today)
        breakdown, status_total = _status_breakdown(db, [project_id])
        attention, attention_total = _critical_tasks_for_projects(db, [project_id], [project], today)
        my_open = total_open
        my_overdue = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter([project_id]),
                Task.due_date.is_not(None),
                Task.due_date < today,
            )
        ) or 0
        my_due_today = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter([project_id]),
                Task.due_date == today,
            )
        ) or 0
        my_due_week = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter([project_id]),
                Task.due_date.is_not(None),
                Task.due_date >= today,
                Task.due_date <= week_end,
            )
        ) or 0
        my_completed = db.scalar(
            select(func.count(Task.id)).where(
                Task.project_id == project_id,
                Task.deleted_at.is_(None),
                Task.completed_at.is_not(None),
                Task.completed_at >= week_ago_dt,
            )
        ) or 0
        my_completed_prev = db.scalar(
            select(func.count(Task.id)).where(
                Task.project_id == project_id,
                Task.deleted_at.is_(None),
                Task.completed_at.is_not(None),
                Task.completed_at >= week_ago_dt - timedelta(days=7),
                Task.completed_at < week_ago_dt,
            )
        ) or 0
        overdue_last_week = db.scalar(
            select(func.count(Task.id)).where(
                *_open_task_filter([project_id]),
                Task.due_date.is_not(None),
                Task.due_date < week_ago,
            )
        ) or 0
        completion_pct = round((done / (total_open + done)) * 100) if (total_open + done) else 0
    else:
        assigned_filter = [
            *_open_task_filter([project_id]),
            Task.id.in_(_assigned_task_ids_subquery(user_id)),
        ]
        my_open = db.scalar(select(func.count(Task.id)).where(*assigned_filter)) or 0
        my_overdue = db.scalar(
            select(func.count(Task.id)).where(
                *assigned_filter,
                Task.due_date.is_not(None),
                Task.due_date < today,
            )
        ) or 0
        my_due_today = db.scalar(
            select(func.count(Task.id)).where(
                *assigned_filter,
                Task.due_date == today,
            )
        ) or 0
        my_due_week = db.scalar(
            select(func.count(Task.id)).where(
                *assigned_filter,
                Task.due_date.is_not(None),
                Task.due_date >= today,
                Task.due_date <= week_end,
            )
        ) or 0
        my_completed = db.scalar(
            select(func.count(Task.id))
            .where(
                Task.project_id == project_id,
                Task.deleted_at.is_(None),
                Task.completed_at.is_not(None),
                Task.completed_at >= week_ago_dt,
                Task.id.in_(_assigned_task_ids_subquery(user_id)),
            )
        ) or 0
        my_completed_prev = db.scalar(
            select(func.count(Task.id))
            .where(
                Task.project_id == project_id,
                Task.deleted_at.is_(None),
                Task.completed_at.is_not(None),
                Task.completed_at >= week_ago_dt - timedelta(days=7),
                Task.completed_at < week_ago_dt,
                Task.id.in_(_assigned_task_ids_subquery(user_id)),
            )
        ) or 0
        overdue_last_week = db.scalar(
            select(func.count(Task.id)).where(
                *assigned_filter,
                Task.due_date.is_not(None),
                Task.due_date < week_ago,
            )
        ) or 0
        breakdown, status_total = _status_breakdown_for_assignee(db, [project_id], user_id)
        attention, attention_total = _critical_tasks_for_assignee(
            db, [project_id], [project], today, user_id
        )
        total_open, done, _overdue = _task_counts(db, [project_id], today)
        completion_pct = round((done / (total_open + done)) * 100) if (total_open + done) else 0

    sprints = _sprint_summaries(db, project.workspace_id, [project_id])

    kpis = ProjectMemberDashboardKpis(
        my_open_tasks=int(my_open),
        my_overdue=int(my_overdue),
        my_due_today=int(my_due_today),
        my_due_this_week=int(my_due_week),
        my_completed_this_week=int(my_completed),
        project_completion_percent=completion_pct,
        active_sprint_count=len(sprints),
        trends={
            "my_completed_this_week": _trend(int(my_completed) - int(my_completed_prev), unit="last week"),
            "my_overdue": _trend(int(my_overdue) - int(overdue_last_week), unit="last week", positive_is_good=False),
        },
    )

    activities = _recent_activities_for_project(
        db, project.id, project.workspace_id, project.name, period_start, actor_id=perms.user.id
    )

    return ProjectMemberDashboardOut(
        project_id=project.id,
        project_name=project.name,
        project_color=project.color,
        space_name=space.name if space else None,
        my_role=my_role,
        kpis=kpis,
        my_task_status_breakdown=breakdown,
        my_task_status_total=status_total,
        my_attention_tasks=attention,
        my_attention_total=attention_total,
        active_sprints=sprints,
        recent_activities=activities,
    )


# ===================================================================
# User Role Summary
# ===================================================================


def resolve_user_roles(db: Session, perms: PermissionService, org_id: uuid.UUID) -> UserRoleSummary:
    """Build a comprehensive role summary for the current user across all scopes."""
    org = perms.get_org_or_404(org_id)
    org_role = perms.org_role(org_id)

    # Workspace roles
    ws_rows = db.execute(
        select(Workspace.id, Workspace.name, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.organization_id == org_id,
            Workspace.deleted_at.is_(None),
            WorkspaceMember.user_id == perms.user.id,
        )
        .order_by(Workspace.name)
    ).all()
    workspace_roles = [
        WorkspaceRoleItem(workspace_id=r[0], workspace_name=r[1], role=r[2])
        for r in ws_rows
    ]

    # Space roles
    ws_ids = [r[0] for r in ws_rows]
    if ws_ids:
        space_rows = db.execute(
            select(Space.id, Space.name, Workspace.id, Workspace.name, SpaceMember.role)
            .join(SpaceMember, SpaceMember.space_id == Space.id)
            .join(Workspace, Workspace.id == Space.workspace_id)
            .where(
                Space.workspace_id.in_(ws_ids),
                Space.deleted_at.is_(None),
                SpaceMember.user_id == perms.user.id,
            )
            .order_by(Workspace.name, Space.name)
        ).all()
    elif org_role not in ("owner", "admin"):
        # Space admin without workspace membership still needs space roles surfaced.
        space_rows = db.execute(
            select(Space.id, Space.name, Workspace.id, Workspace.name, SpaceMember.role)
            .join(SpaceMember, SpaceMember.space_id == Space.id)
            .join(Workspace, Workspace.id == Space.workspace_id)
            .where(
                Workspace.organization_id == org_id,
                Space.deleted_at.is_(None),
                SpaceMember.user_id == perms.user.id,
            )
            .order_by(Workspace.name, Space.name)
        ).all()
    else:
        space_rows = []
    # Also check spaces in workspaces the user isn't a member of but org admin can see
    if org_role in ("owner", "admin"):
        all_ws_ids = list(db.scalars(
            select(Workspace.id).where(Workspace.organization_id == org_id, Workspace.deleted_at.is_(None))
        ).all())
        extra_ws = [wid for wid in all_ws_ids if wid not in ws_ids]
        if extra_ws:
            extra_space_rows = db.execute(
                select(Space.id, Space.name, Workspace.id, Workspace.name, SpaceMember.role)
                .join(SpaceMember, SpaceMember.space_id == Space.id)
                .join(Workspace, Workspace.id == Space.workspace_id)
                .where(
                    Space.workspace_id.in_(extra_ws),
                    Space.deleted_at.is_(None),
                    SpaceMember.user_id == perms.user.id,
                )
                .order_by(Workspace.name, Space.name)
            ).all()
            space_rows = list(space_rows) + list(extra_space_rows)
    space_roles = [
        SpaceRoleItem(space_id=r[0], space_name=r[1], workspace_id=r[2], workspace_name=r[3], role=r[4])
        for r in space_rows
    ]

    # Project roles (explicit membership only)
    from app.models.project import ProjectMember
    proj_rows = db.execute(
        select(
            Project.id,
            Project.name,
            Space.name,
            Project.workspace_id,
            ProjectMember.role,
            Project.space_id,
            Project.is_personal,
        )
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .join(Workspace, Workspace.id == Project.workspace_id)
        .outerjoin(Space, Space.id == Project.space_id)
        .where(
            Workspace.organization_id == org_id,
            Project.deleted_at.is_(None),
            Project.is_archived.is_(False),
            ProjectMember.user_id == perms.user.id,
        )
        .order_by(Project.name)
    ).all()
    project_roles = [
        ProjectRoleItem(
            project_id=r[0],
            project_name=r[1],
            space_name=r[2],
            workspace_id=r[3],
            role=r[4],
            space_id=r[5],
            is_personal=bool(r[6]),
        )
        for r in proj_rows
    ]

    # Determine highest role (Personal List admin does not count as project_admin)
    non_personal_project_roles = [pr for pr in project_roles if not pr.is_personal]
    if org_role == "owner":
        highest = "org_owner"
    elif org_role == "admin":
        highest = "org_admin"
    elif any(wr.role == "admin" for wr in workspace_roles):
        highest = "workspace_admin"
    elif any(sr.role == "admin" for sr in space_roles):
        highest = "space_admin"
    elif any(pr.role == "admin" for pr in non_personal_project_roles):
        highest = "project_admin"
    elif any(pr.role == "member" for pr in non_personal_project_roles):
        highest = "project_member"
    elif any(pr.role == "viewer" for pr in non_personal_project_roles):
        highest = "project_viewer"
    elif org_role == "member":
        highest = "org_member"
    else:
        highest = "member"

    return UserRoleSummary(
        highest_role=highest,
        org_role=org_role,
        org_name=org.name,
        workspace_roles=workspace_roles,
        space_roles=space_roles,
        project_roles=project_roles,
    )
