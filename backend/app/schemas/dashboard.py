import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief
from app.schemas.workspace import StatusCount


class DashboardTrend(BaseModel):
    label: str
    direction: str  # up | down | flat
    tone: str  # positive | negative | neutral


class DashboardKpis(BaseModel):
    active_projects: int
    organization_members: int
    teams: int
    active_sprints: int
    overdue_tasks: int
    completion_percent: int
    workspaces: int = 0
    trends: dict[str, DashboardTrend]


class ProjectProgressRow(BaseModel):
    project_id: uuid.UUID
    name: str
    color: str
    progress_percent: int


class TeamWorkloadRow(BaseModel):
    team_id: uuid.UUID
    name: str
    color: str
    member_count: int
    open_tasks: int
    overdue_tasks: int
    completed_tasks: int


class TeamProductivityRow(BaseModel):
    team_id: uuid.UUID
    name: str
    completed_count: int


class TeamProductivitySeries(BaseModel):
    """One team (or aggregated "other") line in the productivity chart."""

    key: str
    team_id: uuid.UUID | None = None
    name: str
    color: str


class TeamProductivityTrendPoint(BaseModel):
    day: date
    label: str
    counts: dict[str, int]


class TeamProductivitySummary(BaseModel):
    total_completed: int = 0
    previous_period_total: int = 0
    active_teams: int = 0
    leading_team_name: str | None = None
    leading_team_count: int = 0
    # Large-org chart context: team-level top-N, or workspace rollup when team count is high.
    display_mode: str = "team"  # team | workspace
    total_teams: int = 0
    total_entities: int = 0
    featured_count: int = 0
    other_entities_count: int = 0


class DeliveryVelocityTrendPoint(BaseModel):
    day: date
    label: str
    completed_count: int


class DeliveryVelocitySummary(BaseModel):
    total_completed: int = 0
    previous_period_total: int = 0
    daily_average: int = 0
    best_day_label: str | None = None
    best_day_count: int = 0


class CriticalTaskRow(BaseModel):
    task_id: uuid.UUID
    title: str
    project_id: uuid.UUID
    project_name: str
    task_ref: str
    assignee: UserBrief | None = None
    due_date: date | None = None
    status_name: str
    status_color: str
    status_kind: str  # overdue | blocked | critical | due_soon


class DashboardActivityRow(BaseModel):
    id: uuid.UUID
    action: str
    summary: str
    actor: UserBrief | None = None
    project_name: str | None = None
    created_at: datetime


class ProjectPortfolioRow(BaseModel):
    project_id: uuid.UUID
    name: str
    color: str
    progress_percent: int
    active_sprint: str | None = None
    task_count: int
    overdue_count: int
    health: str  # healthy | at_risk


class OrgDashboardOut(BaseModel):
    organization_id: uuid.UUID
    organization_name: str
    kpis: DashboardKpis
    project_progress: list[ProjectProgressRow]
    project_progress_total: int = 0
    task_status_total: int
    task_status_breakdown: list[StatusCount]
    team_workload: list[TeamWorkloadRow]
    team_workload_total: int = 0
    team_productivity: list[TeamProductivityRow]
    team_productivity_total: int = 0
    team_productivity_series: list[TeamProductivitySeries] = []
    team_productivity_trend: list[TeamProductivityTrendPoint] = []
    team_productivity_summary: TeamProductivitySummary | None = None
    delivery_velocity_trend: list[DeliveryVelocityTrendPoint] = []
    delivery_velocity_summary: DeliveryVelocitySummary | None = None
    critical_tasks: list[CriticalTaskRow]
    critical_tasks_total: int = 0
    recent_activities: list[DashboardActivityRow]
    project_portfolio: list[ProjectPortfolioRow]


# ---------------------------------------------------------------------------
# Scoped dashboard schemas (workspace / space / project)
# ---------------------------------------------------------------------------


class SpaceOverviewRow(BaseModel):
    space_id: uuid.UUID
    name: str
    color: str
    project_count: int
    task_count: int
    done_count: int


class MemberWorkloadRow(BaseModel):
    user: UserBrief
    open_tasks: int
    completed_tasks: int


class SprintSummaryRow(BaseModel):
    sprint_id: uuid.UUID
    name: str
    status: str
    task_count: int
    completed_tasks: int
    total_points: int
    completed_points: int
    start_date: date | None = None
    end_date: date | None = None


class WorkspaceDashboardKpis(BaseModel):
    total_tasks: int
    open_tasks: int
    completed_tasks: int
    overdue_tasks: int
    completion_percent: int
    spaces: int
    projects: int
    members: int
    active_sprints: int
    trends: dict[str, DashboardTrend]


class WorkspaceDashboardOut(BaseModel):
    workspace_id: uuid.UUID
    workspace_name: str
    kpis: WorkspaceDashboardKpis
    space_overview: list[SpaceOverviewRow]
    task_status_breakdown: list[StatusCount]
    task_status_total: int
    project_progress: list[ProjectProgressRow]
    project_progress_total: int = 0
    member_workload: list[MemberWorkloadRow]
    active_sprints: list[SprintSummaryRow]
    critical_tasks: list[CriticalTaskRow]
    critical_tasks_total: int = 0
    recent_activities: list[DashboardActivityRow]


class SpaceDashboardKpis(BaseModel):
    total_tasks: int
    open_tasks: int
    completed_tasks: int
    overdue_tasks: int
    completion_percent: int
    projects: int
    members: int
    trends: dict[str, DashboardTrend]


class SpaceDashboardOut(BaseModel):
    space_id: uuid.UUID
    space_name: str
    workspace_name: str
    kpis: SpaceDashboardKpis
    project_progress: list[ProjectProgressRow]
    project_progress_total: int = 0
    task_status_breakdown: list[StatusCount]
    task_status_total: int
    member_workload: list[MemberWorkloadRow]
    critical_tasks: list[CriticalTaskRow]
    critical_tasks_total: int = 0
    recent_activities: list[DashboardActivityRow]


class ProjectDashboardKpis(BaseModel):
    total_tasks: int
    open_tasks: int
    completed_tasks: int
    overdue_tasks: int
    completion_percent: int
    sprint_velocity: int
    projects: int = 1
    members: int
    trends: dict[str, DashboardTrend]


class ProjectDashboardOut(BaseModel):
    project_id: uuid.UUID
    project_name: str
    project_color: str
    space_name: str | None = None
    kpis: ProjectDashboardKpis
    task_status_breakdown: list[StatusCount]
    task_status_total: int
    member_workload: list[MemberWorkloadRow]
    active_sprints: list[SprintSummaryRow]
    critical_tasks: list[CriticalTaskRow]
    critical_tasks_total: int = 0
    recent_activities: list[DashboardActivityRow]


class ProjectMemberDashboardKpis(BaseModel):
    my_open_tasks: int
    my_overdue: int
    my_due_today: int
    my_due_this_week: int
    my_completed_this_week: int
    project_completion_percent: int
    active_sprint_count: int
    trends: dict[str, DashboardTrend]


class ProjectMemberDashboardOut(BaseModel):
    project_id: uuid.UUID
    project_name: str
    project_color: str
    space_name: str | None = None
    my_role: str
    kpis: ProjectMemberDashboardKpis
    my_task_status_breakdown: list[StatusCount]
    my_task_status_total: int
    my_attention_tasks: list[CriticalTaskRow]
    my_attention_total: int = 0
    active_sprints: list[SprintSummaryRow]
    recent_activities: list[DashboardActivityRow]


# ---------------------------------------------------------------------------
# User role summary (GET /users/me/roles)
# ---------------------------------------------------------------------------


class WorkspaceRoleItem(BaseModel):
    workspace_id: uuid.UUID
    workspace_name: str
    role: str


class SpaceRoleItem(BaseModel):
    space_id: uuid.UUID
    space_name: str
    workspace_id: uuid.UUID
    workspace_name: str
    role: str


class ProjectRoleItem(BaseModel):
    project_id: uuid.UUID
    project_name: str
    space_id: uuid.UUID | None = None
    space_name: str | None = None
    workspace_id: uuid.UUID
    role: str
    is_personal: bool = False


class UserRoleSummary(BaseModel):
    highest_role: str
    org_role: str | None = None
    org_name: str | None = None
    workspace_roles: list[WorkspaceRoleItem] = []
    space_roles: list[SpaceRoleItem] = []
    project_roles: list[ProjectRoleItem] = []
