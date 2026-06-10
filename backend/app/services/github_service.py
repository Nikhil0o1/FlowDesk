"""GitHub webhook processing: signature check, event storage, task linking, notifications."""
import hashlib
import hmac
import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.websocket import emit
from app.models.github import GithubEvent, GithubRepository
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.services import email_service
from app.services.activity_service import log_activity
from app.services.notification_service import notify
from app.services.user_service import user_briefs

TASK_REF_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,9})-(\d+)\b")


def verify_signature(payload: bytes, signature_header: str | None) -> bool:
    if not settings.GITHUB_WEBHOOK_SECRET:
        # Dev convenience: accept unsigned when no secret configured
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(
        settings.GITHUB_WEBHOOK_SECRET.encode(), payload, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature_header.removeprefix("sha256="), expected)


def find_linked_task(db: Session, repo: GithubRepository, *texts: str) -> Task | None:
    """Find a task referenced as KEY-123 in commit/PR text, scoped to the linked project."""
    for text in texts:
        for key, number in TASK_REF_RE.findall(text or ""):
            query = (
                select(Task)
                .join(Project, Project.id == Task.project_id)
                .where(
                    Project.key == key,
                    Task.number == int(number),
                    Task.deleted_at.is_(None),
                )
            )
            if repo.project_id:
                query = query.where(Task.project_id == repo.project_id)
            elif repo.workspace_id:
                query = query.where(Project.workspace_id == repo.workspace_id)
            task = db.scalar(query)
            if task:
                return task
    return None


def _notify_project_members(
    db: Session, repo: GithubRepository, ntype: str, title: str, body: str, url: str, send_email: bool
) -> None:
    if not repo.project_id:
        return
    member_ids = db.scalars(
        select(ProjectMember.user_id).where(ProjectMember.project_id == repo.project_id)
    ).all()
    briefs = user_briefs(db, list(member_ids))
    project = db.get(Project, repo.project_id)
    for uid in member_ids:
        notify(
            db, uid, ntype, title, body,
            data={"repo": repo.repo_full_name, "url": url, "project_id": str(repo.project_id)},
            workspace_id=project.workspace_id if project else None,
            project_id=repo.project_id,
        )
        if send_email and uid in briefs:
            email_service.send_github_pr_email(briefs[uid].email, ntype.replace("github_pr_", ""), title, repo.repo_full_name, url)


def process_event(
    db: Session,
    event_type: str,
    delivery_id: str | None,
    payload: dict,
) -> int:
    """Process one webhook delivery. Returns number of stored events."""
    if delivery_id and db.scalar(select(GithubEvent).where(GithubEvent.delivery_id == delivery_id)):
        return 0  # duplicate delivery

    repo_payload = payload.get("repository") or {}
    repo_id = repo_payload.get("id")
    if not repo_id:
        return 0
    repos = db.scalars(
        select(GithubRepository).where(
            GithubRepository.repo_id == repo_id, GithubRepository.is_active.is_(True)
        )
    ).all()
    if not repos:
        return 0

    action = payload.get("action")
    sender = (payload.get("sender") or {}).get("login")
    stored = 0

    for repo in repos:
        task: Task | None = None
        summary = ""
        ntype = None
        url = repo_payload.get("html_url", "")
        send_email = False

        if event_type == "push":
            commits = payload.get("commits") or []
            messages = [c.get("message", "") for c in commits]
            task = find_linked_task(db, repo, *messages)
            summary = f"{sender} pushed {len(commits)} commit(s) to {payload.get('ref', '').replace('refs/heads/', '')}"
            ntype = "github_commit_pushed"
            url = payload.get("compare", url)
        elif event_type == "pull_request":
            pr = payload.get("pull_request") or {}
            merged = bool(pr.get("merged"))
            task = find_linked_task(db, repo, pr.get("title", ""), pr.get("body", ""))
            url = pr.get("html_url", url)
            if action == "opened":
                summary = f"PR #{pr.get('number')} opened: {pr.get('title', '')}"
                ntype = "github_pr_opened"
                send_email = True
            elif action == "closed":
                action_label = "merged" if merged else "closed"
                summary = f"PR #{pr.get('number')} {action_label}: {pr.get('title', '')}"
                ntype = "github_pr_merged" if merged else None
                send_email = merged
            else:
                summary = f"PR #{pr.get('number')} {action}"
        elif event_type == "issues":
            issue = payload.get("issue") or {}
            task = find_linked_task(db, repo, issue.get("title", ""), issue.get("body", ""))
            summary = f"Issue #{issue.get('number')} {action}: {issue.get('title', '')}"
            url = issue.get("html_url", url)
        else:
            summary = f"{event_type} {action or ''}".strip()

        event = GithubEvent(
            repository_id=repo.id,
            event_type=event_type,
            action="merged" if event_type == "pull_request" and action == "closed"
            and (payload.get("pull_request") or {}).get("merged") else action,
            actor_login=sender,
            payload={
                "summary": summary,
                "url": url,
                "repo": repo.repo_full_name,
                # keep a trimmed payload, not the entire GitHub blob
                "title": (payload.get("pull_request") or payload.get("issue") or {}).get("title"),
                "number": (payload.get("pull_request") or payload.get("issue") or {}).get("number"),
                "ref": payload.get("ref"),
                "commit_count": len(payload.get("commits") or []),
            },
            task_id=task.id if task else None,
            delivery_id=delivery_id if stored == 0 else None,
        )
        db.add(event)
        stored += 1

        project = db.get(Project, repo.project_id) if repo.project_id else None
        if project:
            log_activity(
                db,
                workspace_id=project.workspace_id,
                project_id=project.id,
                task_id=task.id if task else None,
                actor_id=None,
                action=f"github.{event_type}" + (f".{action}" if action else ""),
                data={"summary": summary, "url": url, "actor": sender, "repo": repo.repo_full_name},
            )
            emit(
                "github.event.created",
                [f"project:{project.id}", f"workspace:{project.workspace_id}"],
                payload={"summary": summary, "url": url, "repo": repo.repo_full_name,
                         "event_type": event_type, "action": action,
                         "task_id": str(task.id) if task else None},
                project_id=project.id,
                workspace_id=project.workspace_id,
            )
        if ntype and project:
            _notify_project_members(db, repo, ntype, summary, repo.repo_full_name, url, send_email)

    db.commit()
    return stored
