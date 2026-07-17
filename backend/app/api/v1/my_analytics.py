"""Personal analytics — every user sees only their own data.

``user_id`` is always taken from the JWT via ``get_current_user``; never from
query parameters or request bodies.
"""
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.schemas.my_analytics import (
    CollaborationOut,
    DeadlinePerformanceOut,
    MyAnalyticsOverviewOut,
    PersonalActivityOut,
    PersonalBenchmarksOut,
    PriorityAnalysisOut,
    ProductivityTrendOut,
    ProjectContributionOut,
    TaskTrendsOut,
    TimeDistributionOut,
    WorkPatternOut,
)
from app.services import my_analytics_service
from app.services.permission_service import PermissionService

router = APIRouter(tags=["my-analytics"])


@router.get("/my-analytics/overview", response_model=MyAnalyticsOverviewOut)
def my_analytics_overview(
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_overview(db, perms)


@router.get("/my-analytics/productivity-trend", response_model=ProductivityTrendOut)
def my_analytics_productivity_trend(
    period: Literal["week", "month"] = Query("week"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_productivity_trend(db, perms, period)


@router.get("/my-analytics/task-trends", response_model=TaskTrendsOut)
def my_analytics_task_trends(
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Current week (Mon–Sun): completed tasks per weekday."""
    return my_analytics_service.get_task_trends(db, perms)


@router.get("/my-analytics/deadline-performance", response_model=DeadlinePerformanceOut)
def my_analytics_deadline_performance(
    days: int = Query(90, ge=1, le=365),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_deadline_performance(db, perms, days)


@router.get("/my-analytics/activity", response_model=PersonalActivityOut)
def my_analytics_activity(
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_activity(db, perms, limit)


@router.get("/my-analytics/work-pattern", response_model=WorkPatternOut)
def my_analytics_work_pattern(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_work_pattern(db, perms, days)


@router.get("/my-analytics/time-distribution", response_model=TimeDistributionOut)
def my_analytics_time_distribution(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_time_distribution(db, perms, days)


@router.get("/my-analytics/project-contribution", response_model=ProjectContributionOut)
def my_analytics_project_contribution(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_project_contribution(db, perms, days)


@router.get("/my-analytics/collaboration", response_model=CollaborationOut)
def my_analytics_collaboration(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_collaboration(db, perms, days)


@router.get("/my-analytics/priority-analysis", response_model=PriorityAnalysisOut)
def my_analytics_priority_analysis(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_priority_analysis(db, perms, days)


@router.get("/my-analytics/benchmarks", response_model=PersonalBenchmarksOut)
def my_analytics_benchmarks(
    period: Literal["week", "month"] = Query("week"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return my_analytics_service.get_benchmarks(db, perms, period)
