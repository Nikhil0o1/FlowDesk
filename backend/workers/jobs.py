"""Scheduled background job implementations. Each returns items processed (int)."""
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.task_ref import format_task_ref
from app.core.websocket import emit
from app.models.invite import Invite
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.task import CustomStatus, RecurringTask, Task, TaskAssignee
from app.models.time_entry import TimeEntry
from app.models.user import Profile, User
from app.models.github import GithubRepository
from app.core.email_safety import escape_html
from app.services import email_service
from app.services.notification_service import notify

logger = logging.getLogger(__name__)

# Batch sizes for scheduled jobs that iterate over potentially large row sets.
# Streaming in batches keeps memory bounded and lets us commit mid-run so a
# failure part-way through neither holds one giant transaction open nor loses
# all prior work.
_USER_BATCH = 500
_NOTIFY_COMMIT_BATCH = 100


def _task_url(task: Task) -> str:
    return f"{settings.FRONTEND_URL}/app/tasks/{task.id}"


def _task_ref(db: Session, task: Task) -> str:
    project = db.get(Project, task.project_id)
    return format_task_ref(project.id, task.number) if project else f"TASK-{task.number}"


def _notify_assignees(
    db: Session,
    task: Task,
    ntype: str,
    title: str,
    body: str,
    send_email_fn=None,
) -> int:
    assignee_ids = db.scalars(
        select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)
    ).all()
    count = 0
    for uid in assignee_ids:
        notify(db, uid, ntype, title, body, data={"task_id": str(task.id)}, project_id=task.project_id)
        user = db.get(User, uid)
        if user and send_email_fn:
            send_email_fn(user)
        count += 1
    return count


def due_date_reminders(db: Session) -> int:
    today = date.today()
    tasks = db.scalars(
        select(Task).where(
            Task.due_date == today,
            Task.deleted_at.is_(None),
            Task.completed_at.is_(None),
            Task.is_archived.is_(False),
        )
    ).all()
    count = 0
    for i, task in enumerate(tasks, 1):
        try:
            ref = _task_ref(db, task)
            count += _notify_assignees(
                db,
                task,
                "due_date_reminder",
                f"{ref} is due today",
                task.title,
                lambda user, t=task, r=ref: email_service.send_due_date_reminder_email(
                    user.email, t.title, r, "today", _task_url(t)
                ),
            )
            if i % _NOTIFY_COMMIT_BATCH == 0:
                db.commit()
        except Exception:  # noqa: BLE001 — one task's failure must not abort the run
            db.rollback()
            logger.exception("due_date_reminders failed for task %s", task.id)
    db.commit()
    return count


def overdue_task_notifications(db: Session) -> int:
    today = date.today()
    tasks = db.scalars(
        select(Task).where(
            Task.due_date < today,
            Task.due_date >= today - timedelta(days=7),
            Task.deleted_at.is_(None),
            Task.completed_at.is_(None),
            Task.is_archived.is_(False),
        )
    ).all()
    count = 0
    for i, task in enumerate(tasks, 1):
        try:
            ref = _task_ref(db, task)
            days = (today - task.due_date).days
            count += _notify_assignees(
                db, task, "task_overdue", f"{ref} is overdue by {days} day{'s' if days != 1 else ''}", task.title
            )
            if i % _NOTIFY_COMMIT_BATCH == 0:
                db.commit()
        except Exception:  # noqa: BLE001 — one task's failure must not abort the run
            db.rollback()
            logger.exception("overdue_task_notifications failed for task %s", task.id)
    db.commit()
    return count


def stop_abandoned_timers(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.ABANDONED_TIMER_MAX_HOURS)
    running = db.scalars(
        select(TimeEntry).where(TimeEntry.ended_at.is_(None), TimeEntry.started_at < cutoff)
    ).all()
    for entry in running:
        entry.ended_at = datetime.now(timezone.utc)
        entry.duration_seconds = int((entry.ended_at - entry.started_at).total_seconds())
        entry.stopped_by_system = True
        emit(
            "timer.stopped",
            [f"user:{entry.user_id}"],
            payload={"time_entry_id": str(entry.id), "task_id": str(entry.task_id), "by_system": True},
        )
    db.commit()
    return len(running)


def _send_user_daily_digest(db: Session, user: User, today: date) -> int:
    """Build and send one user's digest. Returns 1 if an email was sent, else 0."""
    task_ids = db.scalars(
        select(TaskAssignee.task_id).where(TaskAssignee.user_id == user.id)
    ).all()
    if not task_ids:
        return 0
    due_today = db.scalars(
        select(Task).where(
            Task.id.in_(task_ids),
            Task.due_date == today,
            Task.completed_at.is_(None),
            Task.deleted_at.is_(None),
        )
    ).all()
    overdue = db.scalar(
        select(func.count(Task.id)).where(
            Task.id.in_(task_ids),
            Task.due_date < today,
            Task.completed_at.is_(None),
            Task.deleted_at.is_(None),
        )
    )
    if not due_today and not overdue:
        return 0
    items = "<ul>"
    for t in due_today[:10]:
        items += f"<li><strong>{escape_html(_task_ref(db, t))}</strong> — {escape_html(t.title)} (due today)</li>"
    if overdue:
        items += f"<li><strong>{overdue}</strong> overdue task{'s' if overdue != 1 else ''}</li>"
    items += "</ul>"
    profile = db.scalar(select(Profile).where(Profile.user_id == user.id))
    email_service.send_daily_digest_email(user.email, profile.full_name if profile else "", items)
    return 1


def daily_digest(db: Session) -> int:
    today = date.today()
    count = 0
    last_id = None
    # Stream active users in id-ordered batches: memory stays bounded no matter how
    # many users exist, each batch is checkpointed, and one user's failure (bad data,
    # email error) is isolated instead of aborting the whole run.
    while True:
        stmt = select(User).where(User.is_active.is_(True), User.deleted_at.is_(None))
        if last_id is not None:
            stmt = stmt.where(User.id > last_id)
        users = db.scalars(stmt.order_by(User.id).limit(_USER_BATCH)).all()
        if not users:
            break
        last_id = users[-1].id
        for user in users:
            if user.is_platform_superadmin:
                continue
            try:
                count += _send_user_daily_digest(db, user, today)
            except Exception:  # noqa: BLE001 — isolate per-user failures
                logger.exception("daily_digest failed for user %s", user.id)
        db.commit()  # checkpoint + release the read snapshot between batches
        if len(users) < _USER_BATCH:
            break
    return count


def github_sync_fallback(db: Session) -> int:
    """Poll linked repos and import GitHub issues missed by webhooks."""
    from app.models.github import GithubRepository
    from app.services.github_service import sync_project_issues

    project_ids = db.scalars(
        select(GithubRepository.project_id)
        .where(
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
            GithubRepository.project_id.isnot(None),
        )
        .distinct()
    ).all()
    imported = 0
    status_synced = 0
    for project_id in project_ids:
        if project_id is None:
            continue
        try:
            imp, synced = sync_project_issues(db, project_id)
            imported += imp
            status_synced += synced
        except Exception:  # noqa: BLE001 — one project must not block the rest
            logger.exception("github_sync_fallback failed for project %s", project_id)
    if imported or status_synced:
        db.commit()
    return imported + status_synced


def recurring_task_generation(db: Session) -> int:
    now = datetime.now(timezone.utc)
    due = db.scalars(
        select(RecurringTask).where(
            RecurringTask.is_active.is_(True), RecurringTask.next_occurrence_at <= now
        )
    ).all()
    count = 0
    for rec in due:
        project = db.get(Project, rec.project_id)
        if not project or project.deleted_at is not None:
            rec.is_active = False
            continue
        template = rec.template or {}
        default_status = db.scalar(
            select(CustomStatus)
            .where(CustomStatus.project_id == project.id)
            .order_by(CustomStatus.position)
        )
        number = project.next_task_number
        project.next_task_number = number + 1
        task = Task(
            project_id=project.id,
            list_id=rec.list_id,
            number=number,
            title=template.get("title", "Recurring task"),
            description=template.get("description"),
            priority=template.get("priority"),
            task_type=template.get("task_type", "task"),
            status_id=default_status.id if default_status else None,
            labels=template.get("labels", []),
            story_points=template.get("story_points"),
            due_date=date.today() + timedelta(days=int(template.get("due_in_days", 0) or 0)),
            created_by=rec.created_by,
        )
        db.add(task)
        db.flush()
        for uid in template.get("assignee_ids", []):
            try:
                db.add(TaskAssignee(task_id=task.id, user_id=uid))
            except Exception:  # noqa: BLE001
                pass
        step_days = {"daily": 1, "weekly": 7, "monthly": 30}.get(rec.frequency, 1) * max(rec.interval, 1)
        rec.last_created_at = now
        rec.next_occurrence_at = rec.next_occurrence_at + timedelta(days=step_days)
        emit(
            "task.created",
            [f"project:{project.id}", f"workspace:{project.workspace_id}"],
            payload={"task_id": str(task.id), "title": task.title, "recurring": True},
            project_id=project.id,
            workspace_id=project.workspace_id,
        )
        count += 1
    db.commit()
    return count


def sprint_completion_reminder(db: Session) -> int:
    soon = date.today() + timedelta(days=1)
    sprints = db.scalars(
        select(Sprint).where(
            Sprint.status == "active", Sprint.end_date.is_not(None), Sprint.end_date <= soon,
            Sprint.deleted_at.is_(None),
        )
    ).all()
    count = 0
    for sprint in sprints:
        if sprint.scrum_master_id:
            notify(
                db,
                sprint.scrum_master_id,
                "sprint_completed",
                f"Sprint '{sprint.name}' ends {'today' if sprint.end_date == date.today() else 'tomorrow'}",
                "Review the board and complete the sprint.",
                data={"sprint_id": str(sprint.id)},
                workspace_id=sprint.workspace_id,
                project_id=sprint.project_id,
            )
            count += 1
    db.commit()
    return count


def cleanup_expired_invites(db: Session) -> int:
    now = datetime.now(timezone.utc)
    expired = db.scalars(
        select(Invite).where(Invite.status == "pending", Invite.expires_at <= now)
    ).all()
    for invite in expired:
        invite.status = "expired"
    db.commit()
    return len(expired)


def google_sheet_sync(db: Session) -> int:
    """Mirror projects with live sync enabled to their Google Sheets."""
    from app.models.integration import GoogleSheetSync
    from app.services.sheet_sync_service import run_sync

    syncs = db.scalars(select(GoogleSheetSync).where(GoogleSheetSync.is_active.is_(True))).all()
    count = 0
    for sync in syncs:
        try:
            if run_sync(db, sync):
                count += 1
        except Exception:  # noqa: BLE001 — one broken sync must not stop the rest
            db.rollback()
            logger.exception("Sheet sync failed for project %s", sync.project_id)
    return count


def pat_apply_delayed_revocations(db: Session) -> int:
    from app.services import api_token_service

    count = api_token_service.apply_due_revocations(db)
    if count:
        db.commit()
    return count


def pat_cleanup_expired(db: Session) -> int:
    from app.services import api_token_service

    count = api_token_service.cleanup_expired_pats(db)
    if count:
        db.commit()
    return count


def pat_flush_denial_audits(db: Session) -> int:
    from app.core.pat_audit import flush_denial_aggregates

    return flush_denial_aggregates(db)


def pat_pepper_migration_report(db: Session) -> int:
    from app.services import api_token_service

    report = api_token_service.pepper_migration_report(db)
    logger.info("PAT pepper migration report: %s", report)
    return int(sum(v for k, v in report.items() if k.startswith("pepper_")))


def webhook_delivery_reconciliation(db: Session) -> int:
    """Re-enqueue stale pending/retrying webhook deliveries (broker crash safety)."""
    from app.services import webhook_service

    return webhook_service.reconcile_stale_deliveries(db)


def webhook_delivery_purge(db: Session) -> int:
    """Delete webhook delivery rows older than retention window."""
    from app.services import webhook_service

    count = webhook_service.purge_old_deliveries(db)
    if count:
        db.commit()
        logger.info("Purged %s webhook deliveries past retention", count)
    return count
