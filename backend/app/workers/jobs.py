"""Scheduled background jobs. Every job run is recorded in cron_job_logs."""
import logging
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.config import settings
from app.core.websocket import emit
from app.db.session import SessionLocal
from app.models.audit import CronJobLog
from app.models.invite import Invite
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.task import CustomStatus, Task, TaskAssignee, RecurringTask
from app.models.time_entry import TimeEntry
from app.models.user import Profile, User
from app.models.github import GithubRepository
from app.services import email_service
from app.services.notification_service import notify

logger = logging.getLogger(__name__)


def run_logged(job_name: str, fn: Callable) -> None:
    """Execute a job function with its own DB session and a cron_job_logs record."""
    db = SessionLocal()
    log = CronJobLog(job_name=job_name, started_at=datetime.now(timezone.utc), status="running")
    db.add(log)
    db.commit()
    try:
        count = fn(db) or 0
        log.status = "success"
        log.items_processed = int(count)
        log.finished_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.status = "failed"
        log.message = str(exc)[:2000]
        log.finished_at = datetime.now(timezone.utc)
        db.commit()
        logger.exception("Cron job %s failed", job_name)
    finally:
        db.close()


def _task_url(task: Task) -> str:
    return f"{settings.FRONTEND_URL}/app/tasks/{task.id}"


def _task_ref(db, task: Task) -> str:
    project = db.get(Project, task.project_id)
    return f"{project.key}-{task.number}" if project else f"TASK-{task.number}"


def _notify_assignees(db, task: Task, ntype: str, title: str, body: str, send_email_fn=None) -> int:
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


# ---------- jobs ----------

def due_date_reminders(db) -> int:
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
    for task in tasks:
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
    db.commit()
    return count


def overdue_task_notifications(db) -> int:
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
    for task in tasks:
        ref = _task_ref(db, task)
        days = (today - task.due_date).days
        count += _notify_assignees(
            db, task, "task_overdue", f"{ref} is overdue by {days} day{'s' if days != 1 else ''}", task.title
        )
    db.commit()
    return count


def stop_abandoned_timers(db) -> int:
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


def daily_digest(db) -> int:
    today = date.today()
    users = db.scalars(select(User).where(User.is_active.is_(True), User.deleted_at.is_(None))).all()
    count = 0
    for user in users:
        if user.is_platform_superadmin:
            continue
        task_ids = db.scalars(
            select(TaskAssignee.task_id).where(TaskAssignee.user_id == user.id)
        ).all()
        if not task_ids:
            continue
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
            continue
        items = "<ul>"
        for t in due_today[:10]:
            items += f"<li><strong>{_task_ref(db, t)}</strong> — {t.title} (due today)</li>"
        if overdue:
            items += f"<li><strong>{overdue}</strong> overdue task{'s' if overdue != 1 else ''}</li>"
        items += "</ul>"
        profile = db.scalar(select(Profile).where(Profile.user_id == user.id))
        email_service.send_daily_digest_email(user.email, profile.full_name if profile else "", items)
        count += 1
    return count


def github_sync_fallback(db) -> int:
    """Fallback reconciliation when webhooks are missed.

    Placeholder: full repo polling requires a GitHub App private key. When
    configured, this would poll the GitHub API for events newer than the last
    stored delivery per active repository.
    """
    active_repos = db.scalar(
        select(func.count(GithubRepository.id)).where(GithubRepository.is_active.is_(True))
    )
    return int(active_repos or 0)


def recurring_task_generation(db) -> int:
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
        # advance schedule
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


def sprint_completion_reminder(db) -> int:
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


def cleanup_expired_invites(db) -> int:
    now = datetime.now(timezone.utc)
    expired = db.scalars(
        select(Invite).where(Invite.status == "pending", Invite.expires_at <= now)
    ).all()
    for invite in expired:
        invite.status = "expired"
    db.commit()
    return len(expired)


def google_sheet_sync(db) -> int:
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
