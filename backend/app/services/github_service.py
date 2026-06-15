"""GitHub webhook processing: signature check, event storage, task linking,
status automation and notifications.

Status automation (ClickUp-style):
- Explicit: mention `PHX-12[In Review]` in a commit message, PR title or PR body
  to move that task to the named status (must exist on the task's project).
- Automatic: a PR whose title/body references a task moves it to the project's
  first status containing "review" when opened, and to the first done-category
  status when merged. Explicit tags always win over the automatic rules.
"""
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
from app.models.task import CustomStatus, Task
from app.services import email_service, task_service
from app.services.activity_service import log_activity
from app.services.notification_service import notify
from app.services.user_service import user_briefs

TASK_REF_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,9})-(\d+)\b")
STATUS_TAG_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,9})-(\d+)\s*\[([^\[\]\n]{1,40})\]")


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


def _task_by_ref(db: Session, repo: GithubRepository, key: str, number: int) -> Task | None:
    query = (
        select(Task)
        .join(Project, Project.id == Task.project_id)
        .where(Project.key == key, Task.number == number, Task.deleted_at.is_(None))
    )
    if repo.project_id:
        query = query.where(Task.project_id == repo.project_id)
    elif repo.workspace_id:
        query = query.where(Project.workspace_id == repo.workspace_id)
    return db.scalar(query)


def find_linked_task(db: Session, repo: GithubRepository, *texts: str,
                     github_issue_number: int | None = None) -> Task | None:
    """Find a task by stored GitHub issue number first, then by KEY-123 text scan."""
    if github_issue_number and repo.project_id:
        task = db.scalar(
            select(Task).where(
                Task.project_id == repo.project_id,
                Task.github_issue_number == github_issue_number,
                Task.deleted_at.is_(None),
            )
        )
        if task:
            return task
    for text in texts:
        for key, number in TASK_REF_RE.findall(text or ""):
            task = _task_by_ref(db, repo, key, int(number))
            if task:
                return task
    return None


def _move_task(db: Session, repo: GithubRepository, task: Task, status: CustomStatus,
               actor: str | None, source: str) -> bool:
    """Apply a status change coming from GitHub, with activity + realtime."""
    if not task_service.apply_status_change(db, task, status.id):
        return False
    project = db.get(Project, task.project_id)
    if project:
        log_activity(
            db, workspace_id=project.workspace_id, project_id=project.id, task_id=task.id,
            actor_id=None, action="github.status_changed",
            data={"status": status.name, "actor": actor, "source": source,
                  "ref": f"{project.key}-{task.number}"},
        )
        task_service.emit_task_event("task.updated", db, project, task, {"status_id": str(status.id)})
    return True


def _status_for(db: Session, project_id: uuid.UUID, *, name: str | None = None,
                name_contains: str | None = None, category: str | None = None) -> CustomStatus | None:
    statuses = db.scalars(
        select(CustomStatus).where(CustomStatus.project_id == project_id).order_by(CustomStatus.position)
    ).all()
    if name is not None:
        target = name.strip().lower()
        for s in statuses:
            if s.name.lower() == target:
                return s
        return None
    if name_contains is not None:
        for s in statuses:
            if name_contains in s.name.lower():
                return s
        return None
    if category is not None:
        for s in statuses:
            if s.category == category:
                return s
    return None


def apply_status_tags(db: Session, repo: GithubRepository, actor: str | None,
                      source: str, *texts: str) -> list[str]:
    """Apply explicit `KEY-123[Status Name]` tags found in the given texts.
    Returns human-readable descriptions of the moves made."""
    moves: list[str] = []
    seen: set[tuple[str, int]] = set()
    for text in texts:
        for key, number, status_name in STATUS_TAG_RE.findall(text or ""):
            if (key, int(number)) in seen:
                continue
            seen.add((key, int(number)))
            task = _task_by_ref(db, repo, key, int(number))
            if not task:
                continue
            status = _status_for(db, task.project_id, name=status_name)
            if status and _move_task(db, repo, task, status, actor, source):
                moves.append(f"{key}-{number} → {status.name}")
    return moves


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
            # Explicit status tags: `PHX-12[In Review]` in a commit message
            moves = apply_status_tags(db, repo, sender, "commit", *messages)
            if moves:
                summary += " · " + ", ".join(moves)
        elif event_type == "pull_request":
            pr = payload.get("pull_request") or {}
            merged = bool(pr.get("merged"))
            # PRs that close an issue inherit its linked task
            closing_issue_number: int | None = None
            for linked in (pr.get("body") or "").split():
                if linked.lstrip("#").isdigit():
                    closing_issue_number = int(linked.lstrip("#"))
                    break
            task = find_linked_task(db, repo, pr.get("title", ""), pr.get("body", ""),
                                    github_issue_number=closing_issue_number)
            url = pr.get("html_url", url)
            moves = apply_status_tags(db, repo, sender, "pull_request",
                                      pr.get("title", ""), pr.get("body", ""))
            if action == "opened":
                summary = f"PR #{pr.get('number')} opened: {pr.get('title', '')}"
                ntype = "github_pr_opened"
                send_email = True
                # Automation: linked task moves to the first "review" status
                if task and not moves:
                    review = _status_for(db, task.project_id, name_contains="review")
                    if review and _move_task(db, repo, task, review, sender, "pr_opened"):
                        moves = [f"→ {review.name}"]
            elif action == "closed":
                action_label = "merged" if merged else "closed"
                summary = f"PR #{pr.get('number')} {action_label}: {pr.get('title', '')}"
                ntype = "github_pr_merged" if merged else None
                send_email = merged
                # Automation: merging the PR completes the linked task
                if merged and task and not moves:
                    done = _status_for(db, task.project_id, category="done")
                    if done and _move_task(db, repo, task, done, sender, "pr_merged"):
                        moves = [f"→ {done.name}"]
            else:
                summary = f"PR #{pr.get('number')} {action}"
            if moves:
                summary += " · " + ", ".join(moves)
        elif event_type == "issues":
            issue = payload.get("issue") or {}
            issue_number = issue.get("number")
            task = find_linked_task(db, repo, issue.get("title", ""), issue.get("body", ""),
                                    github_issue_number=issue_number)
            summary = f"Issue #{issue_number} {action}: {issue.get('title', '')}"
            url = issue.get("html_url", url)
            # Auto-create a FlowDesk task when a new issue is opened on a connected repo
            if action == "opened" and not task and repo.project_id:
                task = _create_task_from_issue(db, repo, issue)
                if task:
                    summary = f"Issue #{issue_number} opened → task {_task_ref(db, task)} created"
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


# ---------------------------------------------------------------------------
# GitHub issue ↔ FlowDesk task sync helpers
# ---------------------------------------------------------------------------

def _task_ref(db: Session, task: Task) -> str:
    project = db.get(Project, task.project_id)
    return f"{project.key}-{task.number}" if project else str(task.id)


def _create_task_from_issue(db: Session, repo: GithubRepository, issue: dict) -> Task | None:
    """Create a FlowDesk task from an incoming GitHub issue (issues.opened event)."""
    if not repo.project_id:
        return None
    project = db.get(Project, repo.project_id)
    if not project:
        return None
    from sqlalchemy import func as sqlfunc, select as saselect
    max_pos = db.scalar(
        saselect(sqlfunc.coalesce(sqlfunc.max(Task.position), 0)).where(Task.project_id == repo.project_id)
    ) or 0
    task = Task(
        project_id=repo.project_id,
        number=task_service.claim_task_number(db, repo.project_id),
        title=issue.get("title", "Untitled"),
        description=issue.get("body") or None,
        status_id=task_service.default_status_id(db, repo.project_id),
        position=max_pos + 1024,
        task_type="task",
        github_issue_number=issue.get("number"),
        github_issue_url=issue.get("html_url"),
    )
    db.add(task)
    db.flush()
    log_activity(
        db,
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        actor_id=None,
        action="github.issue.task_created",
        data={"issue": issue.get("number"), "title": task.title, "repo": repo.repo_full_name},
    )
    return task
