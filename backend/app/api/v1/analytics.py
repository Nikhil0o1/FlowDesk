"""Analytics module (Phase 1) + presence write endpoints.

RBAC is enforced on every request via ``resolve_scope`` → ``require_analytics_access``.

Who may open Analytics (not plain members / viewers):
  org owner, org admin, workspace admin, space admin, project admin.

Who each role sees (presence / activity population):
  1) Surrounding first — only people who belong in the viewer's administered
     workspace / space / project (any membership role there).
  2) Org owner & org admin: entire organization (same access).
  3) Scoped admins: everyone in that surrounding, including another workspace's
     admin who joined as project/space/workspace member. Org owner / org admin
     stay hidden from scoped viewers.

Client filters can only shrink this set — never widen it.
"""
import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.db.session import get_db
from app.models.user import User
from app.schemas.analytics import (
    ActivityFeedItem,
    AlertsOut,
    ContributionHeatmapOut,
    DeviceAnalyticsOut,
    HeartbeatRequest,
    HeatmapOut,
    OverviewOut,
    PresenceUsersPage,
    StatusDistributionOut,
    StatusUpdateRequest,
    TeamActivityOut,
    TimelineOut,
    TrendsOut,
    UserDetailOut,
)
from app.schemas.common import Message
from app.services import analytics_service, presence_service
from app.services.analytics_service import AnalyticsFilters
from app.services.analytics_timezone import viewer_timezone
from app.services.permission_service import PermissionService

router = APIRouter(tags=["analytics"])


def _viewer_tz(db: Session, perms: PermissionService):
    return viewer_timezone(db, perms.user.id)


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _filters(
    workspace_id: uuid.UUID | None,
    space_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    team_id: uuid.UUID | None,
    status: str | None,
    search: str | None,
    date: str | None,
    role: str | None = None,
) -> AnalyticsFilters:
    return AnalyticsFilters(
        workspace_id=workspace_id,
        space_id=space_id,
        project_id=project_id,
        team_id=team_id,
        status=status,
        role=role,
        search=search,
        date=date,
    )


# --------------------------------------------------------------------------
# Analytics reads
# --------------------------------------------------------------------------


@router.get("/analytics/overview", response_model=OverviewOut)
def analytics_overview(
    organization_id: uuid.UUID = Query(...),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_overview(db, scope, _viewer_tz(db, perms))


@router.get("/analytics/timeline", response_model=TimelineOut)
def analytics_timeline(
    organization_id: uuid.UUID = Query(...),
    date: str | None = Query(None),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, date)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_timeline(db, scope, date, _viewer_tz(db, perms))


@router.get("/analytics/status-distribution", response_model=StatusDistributionOut)
def analytics_status_distribution(
    organization_id: uuid.UUID = Query(...),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_status_distribution(db, scope)


@router.get("/analytics/team-activity", response_model=TeamActivityOut)
def analytics_team_activity(
    organization_id: uuid.UUID = Query(...),
    group_by: str = Query("team"),
    workspace_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, None, None, None, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_team_activity(db, scope, group_by, _viewer_tz(db, perms))


@router.get("/analytics/users", response_model=PresenceUsersPage)
def analytics_users(
    organization_id: uuid.UUID = Query(...),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    status: str | None = Query(None),
    role: str | None = Query(None),
    search: str | None = Query(None),
    date: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, status, search, date, role)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_users(db, scope, filters, page, page_size)


@router.get("/analytics/users/{user_id}", response_model=UserDetailOut)
def analytics_user_detail(
    user_id: uuid.UUID,
    organization_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    scope = analytics_service.resolve_scope(db, perms, organization_id)
    return analytics_service.get_user_detail(db, scope, user_id, _viewer_tz(db, perms))


@router.get("/analytics/trends", response_model=TrendsOut)
def analytics_trends(
    organization_id: uuid.UUID = Query(...),
    days: int = Query(30, ge=1, le=365),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_trends(db, scope, days, _viewer_tz(db, perms))


@router.get("/analytics/contribution-heatmap", response_model=ContributionHeatmapOut)
def analytics_contribution_heatmap(
    organization_id: uuid.UUID = Query(...),
    days: int = Query(365, ge=1, le=365),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_contribution_heatmap(db, scope, days, _viewer_tz(db, perms))


@router.get("/analytics/heatmap", response_model=HeatmapOut)
def analytics_heatmap(
    organization_id: uuid.UUID = Query(...),
    days: int = Query(30, ge=1, le=365),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_heatmap(db, scope, days, _viewer_tz(db, perms))


@router.get("/analytics/devices", response_model=DeviceAnalyticsOut)
def analytics_devices(
    organization_id: uuid.UUID = Query(...),
    days: int = Query(30, ge=1, le=365),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_device_analytics(db, scope, days, _viewer_tz(db, perms))


@router.get("/analytics/alerts", response_model=AlertsOut)
def analytics_alerts(
    organization_id: uuid.UUID = Query(...),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_alerts(db, scope, _viewer_tz(db, perms))


@router.get("/analytics/activity-feed", response_model=list[ActivityFeedItem])
def analytics_activity_feed(
    organization_id: uuid.UUID = Query(...),
    workspace_id: uuid.UUID | None = Query(None),
    space_id: uuid.UUID | None = Query(None),
    project_id: uuid.UUID | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    filters = _filters(workspace_id, space_id, project_id, team_id, None, None, None)
    scope = analytics_service.resolve_scope(db, perms, organization_id, filters)
    return analytics_service.get_activity_feed(db, scope, limit)


# --------------------------------------------------------------------------
# Presence writes (any authenticated user reports their own presence)
# --------------------------------------------------------------------------


@router.post("/presence/heartbeat", response_model=Message)
def presence_heartbeat(
    body: HeartbeatRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    presence_service.record_heartbeat(
        db,
        user.id,
        body.status,
        request.headers.get("user-agent"),
        _client_ip(request),
    )
    return Message(detail="ok")


@router.post("/presence/status", response_model=Message)
def presence_status(
    body: StatusUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    presence_service.set_status(db, user.id, body.status)
    return Message(detail="ok")


@router.post("/presence/logout", response_model=Message)
def presence_logout(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    presence_service.end_session(db, user.id)
    return Message(detail="ok")
