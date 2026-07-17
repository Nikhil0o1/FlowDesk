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
import logging
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.websocket import emit
from app.models.comment import Comment
from app.models.github import CONNECTION_PROJECT, GithubConnection, GithubEvent, GithubRepository
from app.models.project import Project, ProjectMember
from app.models.task import CustomStatus, Task
from app.services import email_service, task_service
from app.services import github_api_service
from app.services.activity_service import log_activity
from app.services.github_issue_title import format_github_issue_title, parse_github_issue_task_title
from app.services.github_issue_body import format_github_issue_body, parse_github_issue_description
from app.services.notification_service import notify
from app.services.token_vault import reveal
from app.services.user_service import user_briefs

logger = logging.getLogger(__name__)

from app.core.task_ref import STATUS_TAG_RE, TASK_REF_RE, format_task_ref, project_ref_prefix


def verify_signature(payload: bytes, signature_header: str | None) -> bool:
    secret = settings.GITHUB_WEBHOOK_SECRET
    if not secret:
        # Fail closed in production: an unset secret must never accept unsigned
        # deliveries. Only allow unsigned webhooks in non-production for local dev.
        if settings.is_production:
            logger.error(
                "Rejecting GitHub webhook: GITHUB_WEBHOOK_SECRET is not configured in production."
            )
            return False
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_header.removeprefix("sha256="), expected)


def _task_by_ref(db: Session, repo: GithubRepository, prefix: str, number: int) -> Task | None:
    prefix = prefix.upper()
    query = (
        select(Task)
        .join(Project, Project.id == Task.project_id)
        .where(Task.number == number, Task.deleted_at.is_(None))
    )
    if repo.project_id:
        query = query.where(Task.project_id == repo.project_id)
    elif repo.workspace_id:
        query = query.where(Project.workspace_id == repo.workspace_id)
    for task in db.scalars(query).all():
        if project_ref_prefix(task.project_id) == prefix:
            return task
    return None


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
                  "ref": format_task_ref(project.id, task.number)},
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


def _completed_status_for(db: Session, project_id: uuid.UUID) -> CustomStatus | None:
    """FlowDesk status to use when a GitHub issue is closed or a PR is merged."""
    return (
        _status_for(db, project_id, name="Completed")
        or _status_for(db, project_id, name="Complete")
        or _status_for(db, project_id, name="Done")
        or _status_for(db, project_id, name_contains="complete")
        or _status_for(db, project_id, name_contains="done")
        or _status_for(db, project_id, category="done")
    )


def completed_status_for(db: Session, project_id: uuid.UUID) -> CustomStatus | None:
    """FlowDesk status to use when a GitHub issue is closed or a PR is merged."""
    return _completed_status_for(db, project_id)


def reopen_status_for(db: Session, project_id: uuid.UUID) -> CustomStatus | None:
    """FlowDesk status when a GitHub issue is reopened."""
    statuses = db.scalars(
        select(CustomStatus).where(CustomStatus.project_id == project_id).order_by(CustomStatus.position)
    ).all()
    for s in statuses:
        if s.category == "todo":
            return s
    for s in statuses:
        if re.sub(r"[^a-z0-9]", "", s.name.lower()) == "todo":
            return s
    return (
        _status_for(db, project_id, name="To Do")
        or _status_for(db, project_id, name="Todo")
        or _status_for(db, project_id, name_contains="progress")
    )


def reopen_task_github_issue_state(
    db: Session,
    repo: GithubRepository,
    task: Task,
    *,
    actor: str | None,
) -> bool:
    """Move a linked task back to To Do after its GitHub issue was reopened."""
    reopen = reopen_status_for(db, task.project_id)
    if not reopen:
        return False
    return _move_task(db, repo, task, reopen, actor, "issue_reopened")


def apply_issue_state_to_task(
    db: Session,
    repo: GithubRepository,
    task: Task,
    *,
    state: str,
    actor: str | None,
    source: str,
) -> bool:
    """Move a linked task's board status to reflect GitHub issue open/closed state."""
    if not repo.project_id:
        return False
    normalized = (state or "open").strip().lower()
    if normalized == "closed":
        done = _completed_status_for(db, task.project_id)
        if done:
            return _move_task(db, repo, task, done, actor, source)
        return False
    if normalized == "open":
        reopen = reopen_status_for(db, task.project_id)
        if not reopen:
            return False
        if source == "issue_reopened":
            return reopen_task_github_issue_state(db, repo, task, actor=actor)
        current = db.get(CustomStatus, task.status_id) if task.status_id else None
        if current and current.category == "done":
            return _move_task(db, repo, task, reopen, actor, source)
    return False


def _issue_number_from_url(url: str | None) -> int | None:
    if not url:
        return None
    tail = url.rstrip("/").split("/")[-1]
    return int(tail) if tail.isdigit() else None


def _token_for_repo(db: Session, repo: GithubRepository) -> str | None:
    for conn in _connections_for_repo_sync(db, repo):
        token = reveal(conn.access_token)
        if token:
            return token
    return None


def _parent_issue_number_for_event(
    db: Session,
    repo: GithubRepository,
    issue: dict,
    *,
    parent_issue_payload: dict | None = None,
) -> int | None:
    """Resolve a GitHub sub-issue's parent issue number from webhook/API data."""
    if parent_issue_payload and parent_issue_payload.get("number") is not None:
        return int(parent_issue_payload["number"])
    parent_number = _issue_number_from_url(issue.get("parent_issue_url"))
    if parent_number:
        return parent_number
    issue_number = issue.get("number")
    if issue_number is None:
        return None
    token = _token_for_repo(db, repo)
    if not token:
        return None
    owner, name = repo.repo_full_name.split("/", 1)
    try:
        return github_api_service.get_issue_parent_number(
            token, owner, name, int(issue_number)
        )
    except Exception:
        logger.warning(
            "Could not resolve parent issue for %s#%s",
            repo.repo_full_name,
            issue_number,
            exc_info=True,
        )
        return None


def _enrich_github_issue(
    db: Session,
    repo: GithubRepository,
    issue: dict,
) -> dict:
    """Ensure a webhook issue payload has title/body by fetching from GitHub when needed."""
    if issue.get("title") and issue.get("number") is not None:
        return issue
    issue_number = issue.get("number")
    if issue_number is None:
        return issue
    token = _token_for_repo(db, repo)
    if not token:
        return issue
    owner, name = repo.repo_full_name.split("/", 1)
    try:
        return github_api_service.get_issue(token, owner, name, int(issue_number))
    except Exception:
        logger.warning(
            "Could not fetch GitHub issue %s#%s",
            repo.repo_full_name,
            issue_number,
            exc_info=True,
        )
        return issue


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
            GithubRepository.repo_id == repo_id,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    ).all()
    if not repos:
        return 0

    action = payload.get("action")
    sender = (payload.get("sender") or {}).get("login")
    stored = 0

    for repo in repos:
        if repo.webhook_hook_id:
            for conn in _connections_for_repo_sync(db, repo):
                hook_token = reveal(conn.access_token)
                if hook_token:
                    try:
                        hook_owner, hook_name = repo.repo_full_name.split("/", 1)
                        github_api_service.ensure_flowdesk_webhook_events(
                            hook_token, hook_owner, hook_name, repo.webhook_hook_id
                        )
                    except Exception:
                        pass
                    break

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
                    done = _completed_status_for(db, task.project_id)
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
            if action == "opened" and repo.project_id:
                parent_number = _parent_issue_number_for_event(db, repo, issue)
                parent_task = (
                    find_linked_task(db, repo, github_issue_number=parent_number)
                    if parent_number
                    else None
                )
                issue = _enrich_github_issue(db, repo, issue)
                if parent_task and not task:
                    task = _create_subtask_from_github_issue(db, repo, issue, parent_task)
                    if task:
                        summary = (
                            f"Issue #{issue_number} opened → subtask {_task_ref(db, task)} created"
                        )
                elif not parent_number and not task:
                    task = _create_task_from_issue(db, repo, issue)
                    if task:
                        summary = (
                            f"Issue #{issue_number} opened → task {_task_ref(db, task)} created"
                        )
                elif not task.github_issue_number:
                    task.github_issue_number = issue_number
                    task.github_issue_url = issue.get("html_url")
                    summary = (
                        f"Issue #{issue_number} linked → task {_task_ref(db, task)}"
                    )
            elif action == "edited" and task and repo.project_id:
                project = db.get(Project, repo.project_id)
                if project:
                    sync_bits: list[str] = []
                    parsed_title = parse_github_issue_task_title(
                        issue.get("title", ""), project.name
                    )[:500]
                    if parsed_title != task.title:
                        task.title = parsed_title
                        sync_bits.append(f"title → {parsed_title!r}")
                    parsed_body = parse_github_issue_description(issue.get("body"))
                    if parsed_body != (task.description or None):
                        task.description = parsed_body
                        sync_bits.append("description synced")
                    if sync_bits:
                        summary = f"Issue #{issue_number} " + " · ".join(sync_bits)
            elif action == "closed" and task and repo.project_id:
                if apply_issue_state_to_task(
                    db, repo, task, state="closed", actor=sender, source="issue_closed"
                ):
                    done = db.get(CustomStatus, task.status_id)
                    done_name = done.name if done else "done"
                    summary = (
                        f"Issue #{issue_number} closed → task {_task_ref(db, task)} → {done_name}"
                    )
            elif action == "reopened" and task and repo.project_id:
                if apply_issue_state_to_task(
                    db, repo, task, state="open", actor=sender, source="issue_reopened"
                ):
                    reopen = db.get(CustomStatus, task.status_id)
                    reopen_name = reopen.name if reopen else "open"
                    summary = (
                        f"Issue #{issue_number} reopened → task {_task_ref(db, task)} → {reopen_name}"
                    )
            elif (
                task
                and repo.project_id
                and action not in ("opened", "edited", "labeled", "closed", "reopened")
                and (issue.get("state") or "").lower() == "closed"
            ):
                if apply_issue_state_to_task(
                    db, repo, task, state="closed", actor=sender, source="issue_closed"
                ):
                    done = db.get(CustomStatus, task.status_id)
                    done_name = done.name if done else "done"
                    summary = (
                        f"Issue #{issue_number} closed → task {_task_ref(db, task)} → {done_name}"
                    )
            elif action == "labeled" and task and repo.project_id:
                from app.services.github_api_service import FLOWDESK_LABEL_PREFIX

                label = (payload.get("label") or {}).get("name", "")
                if label.startswith(FLOWDESK_LABEL_PREFIX):
                    status_name = label[len(FLOWDESK_LABEL_PREFIX):].strip()
                    status = _status_for(db, task.project_id, name=status_name)
                    if status and _move_task(db, repo, task, status, sender, "issue_labeled"):
                        summary = (
                            f"Issue #{issue_number} label → task {_task_ref(db, task)} → {status.name}"
                        )
        elif event_type == "issue_comment":
            issue = payload.get("issue") or {}
            gh_comment = payload.get("comment") or {}
            issue_number = issue.get("number")
            task = find_linked_task(db, repo, github_issue_number=issue_number)
            url = gh_comment.get("html_url", issue.get("html_url", url))
            if action == "created" and task and repo.project_id:
                if import_github_issue_comment(
                    db, repo, task, gh_comment, actor_login=sender
                ):
                    summary = (
                        f"Comment on issue #{issue_number} synced → task {_task_ref(db, task)}"
                    )
                else:
                    summary = f"Comment on issue #{issue_number} (skipped or duplicate)"
            else:
                summary = f"Comment on issue #{issue_number} {action or ''}".strip()
        elif event_type == "sub_issues":
            sub_issue = payload.get("sub_issue") or {}
            parent_issue = payload.get("parent_issue") or {}
            sub_number = sub_issue.get("number")
            parent_number = parent_issue.get("number")
            summary = f"Sub-issue #{sub_number} {action or ''}".strip()
            url = sub_issue.get("html_url", url)
            if action == "sub_issue_added" and repo.project_id and sub_number and parent_number:
                parent_task = find_linked_task(
                    db, repo, github_issue_number=parent_number
                )
                if parent_task:
                    enriched = _enrich_github_issue(db, repo, sub_issue)
                    child = _create_subtask_from_github_issue(
                        db, repo, enriched, parent_task
                    )
                    if child:
                        task = child
                        summary = (
                            f"Sub-issue #{sub_number} added → subtask {_task_ref(db, child)}"
                        )
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
    return format_task_ref(project.id, task.number) if project else str(task.id)


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
        title=parse_github_issue_task_title(issue.get("title", ""), project.name)[:500],
        description=parse_github_issue_description(issue.get("body")),
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
    task_service.emit_task_event(
        "task.created", db, project, task, {"source": "github", "issue": issue.get("number")}
    )
    return task


def _create_subtask_from_github_issue(
    db: Session,
    repo: GithubRepository,
    issue: dict,
    parent_task: Task,
) -> Task | None:
    """Create (or link) a FlowDesk subtask from a GitHub sub-issue."""
    if not repo.project_id:
        return None
    project = db.get(Project, repo.project_id)
    if not project:
        return None
    issue_number = issue.get("number")
    if issue_number is None:
        return None
    existing = db.scalar(
        select(Task).where(
            Task.project_id == repo.project_id,
            Task.github_issue_number == issue_number,
            Task.deleted_at.is_(None),
        )
    )
    if existing:
        if existing.parent_task_id != parent_task.id:
            existing.parent_task_id = parent_task.id
        if not existing.github_issue_url:
            existing.github_issue_url = issue.get("html_url")
        return existing

    from sqlalchemy import func as sqlfunc, select as saselect

    max_pos = db.scalar(
        saselect(sqlfunc.coalesce(sqlfunc.max(Task.position), 0)).where(
            Task.project_id == repo.project_id
        )
    ) or 0
    subtask = Task(
        project_id=repo.project_id,
        parent_task_id=parent_task.id,
        number=task_service.claim_task_number(db, repo.project_id),
        title=parse_github_issue_task_title(issue.get("title", ""), project.name)[:500],
        description=parse_github_issue_description(issue.get("body")),
        status_id=task_service.default_status_id(db, repo.project_id),
        position=max_pos + 1024,
        task_type="task",
        github_issue_number=issue_number,
        github_issue_url=issue.get("html_url"),
    )
    db.add(subtask)
    db.flush()
    log_activity(
        db,
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=subtask.id,
        actor_id=None,
        action="github.sub_issue.task_created",
        data={
            "issue": issue_number,
            "parent_task_id": str(parent_task.id),
            "repo": repo.repo_full_name,
        },
    )
    task_service.emit_task_event(
        "task.created",
        db,
        project,
        subtask,
        {"source": "github", "issue": issue_number, "parent_task_id": str(parent_task.id)},
    )
    return subtask


def ensure_task_github_issue(db: Session, task: Task, project: Project) -> None:
    """Create a GitHub issue for a new task when the project has a linked repo (best-effort)."""
    if task.github_issue_number:
        return
    repo = db.scalar(
        select(GithubRepository).where(
            GithubRepository.project_id == project.id,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    )
    if not repo:
        return
    try:
        owner, repo_name = github_api_service.parse_repo_full_name(repo.repo_full_name)
    except github_api_service.GitHubPathValidationError:
        return
    task_ref = _task_ref(db, task)
    issue_title = format_github_issue_title(project.name, task.title)
    issue_body = format_github_issue_body(
        task_ref=task_ref,
        title=task.title,
        description=task.description,
        task_id=task.id,
    )
    for conn in _connections_for_repo_sync(db, repo):
        token = reveal(conn.access_token)
        if not token:
            continue
        try:
            gh_issue = github_api_service.create_issue(
                token, owner, repo_name, title=issue_title, body=issue_body
            )
        except Exception:
            logger.warning(
                "GitHub issue create failed for task %s with connection %s",
                task.id,
                conn.id,
                exc_info=True,
            )
            continue
        task.github_issue_number = gh_issue["number"]
        task.github_issue_url = gh_issue["html_url"]
        if task.parent_task_id:
            parent = db.get(Task, task.parent_task_id)
            if parent and parent.github_issue_number and gh_issue.get("id"):
                try:
                    github_api_service.add_sub_issue(
                        token,
                        owner,
                        repo_name,
                        parent.github_issue_number,
                        gh_issue["id"],
                    )
                except Exception:
                    logger.exception(
                        "Failed to link GitHub sub-issue for task %s under parent issue #%s",
                        task.id,
                        parent.github_issue_number,
                    )
        log_activity(
            db,
            workspace_id=project.workspace_id,
            project_id=project.id,
            task_id=task.id,
            actor_id=None,
            action="github.issue.auto_created",
            data={"issue": gh_issue["number"], "repo": repo.repo_full_name},
        )
        return
    logger.error("Failed to auto-create GitHub issue for task %s — no working token", task.id)


def _connections_for_repo_sync(db: Session, repo: GithubRepository) -> list[GithubConnection]:
    """GitHub connections to try when polling a linked repo (repo link, then project)."""
    connections: list[GithubConnection] = []
    seen: set[uuid.UUID] = set()

    if repo.connection_id:
        conn = db.get(GithubConnection, repo.connection_id)
        if conn:
            connections.append(conn)
            seen.add(conn.id)

    if repo.project_id:
        proj_conn = db.scalar(
            select(GithubConnection).where(
                GithubConnection.project_id == repo.project_id,
                GithubConnection.connection_type == CONNECTION_PROJECT,
            )
        )
        if proj_conn and proj_conn.id not in seen:
            connections.append(proj_conn)
    return connections


def _github_token_for_repo(
    db: Session, repo: GithubRepository
) -> tuple[str, str, str] | None:
    """Return ``(token, owner, repo_name)`` using the first working connection for a linked repo."""
    owner, name = repo.repo_full_name.split("/", 1)
    for conn in _connections_for_repo_sync(db, repo):
        token = reveal(conn.access_token)
        if token:
            return token, owner, name
    return None


def _active_repo_for_task_project(db: Session, project_id: uuid.UUID) -> GithubRepository | None:
    return db.scalar(
        select(GithubRepository).where(
            GithubRepository.project_id == project_id,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    )


def sync_task_issue_status_from_github(db: Session, task: Task) -> bool:
    """Poll GitHub for a linked issue's state and mirror it onto the task (webhook fallback)."""
    from app.services import github_api_service
    from app.services.github_api_service import GitHubApiError

    if not task.github_issue_number or not task.project_id:
        return False
    repo = _active_repo_for_task_project(db, task.project_id)
    if not repo:
        return False
    creds = _github_token_for_repo(db, repo)
    if not creds:
        return False
    token, owner, name = creds
    try:
        issue = github_api_service.get_issue(token, owner, name, task.github_issue_number)
    except GitHubApiError as exc:
        if exc.http_status != 404:
            logger.warning(
                "Could not fetch GitHub issue %s#%s for task %s: %s",
                repo.repo_full_name,
                task.github_issue_number,
                task.id,
                exc.detail,
            )
        return False
    except Exception:
        logger.warning(
            "Could not fetch GitHub issue %s#%s for task %s",
            repo.repo_full_name,
            task.github_issue_number,
            task.id,
            exc_info=True,
        )
        return False
    return apply_issue_state_to_task(
        db,
        repo,
        task,
        state=issue.get("state", "open"),
        actor=None,
        source="issue_poll",
    )


def sync_project_linked_issue_statuses(db: Session, project_id: uuid.UUID) -> int:
    """Mirror GitHub open/closed state for every task in the project that has a linked issue."""
    tasks = db.scalars(
        select(Task).where(
            Task.project_id == project_id,
            Task.github_issue_number.isnot(None),
            Task.deleted_at.is_(None),
        )
    ).all()
    updated = 0
    for task in tasks:
        if sync_task_issue_status_from_github(db, task):
            updated += 1
    return updated


def _fetch_open_issues_for_repo(
    db: Session,
    repo: GithubRepository,
    *,
    limit: int = 100,
    sort: str = "updated",
    direction: str = "desc",
) -> list[dict] | None:
    """List open issues using the first working token for this repo."""
    from app.services import github_api_service
    from app.services.github_api_service import GitHubApiError
    owner, name = repo.repo_full_name.split("/", 1)
    for conn in _connections_for_repo_sync(db, repo):
        token = reveal(conn.access_token)
        if not token:
            continue
        try:
            return github_api_service.list_open_issues(
                token, owner, name, limit=limit, sort=sort, direction=direction
            )
        except GitHubApiError as exc:
            if exc.http_status == 401:
                logger.info(
                    "GitHub token rejected for %s (%s) — trying next connection",
                    repo.repo_full_name,
                    conn.connection_type,
                )
                continue
            logger.warning(
                "Issue list failed for %s: %s", repo.repo_full_name, exc.detail
            )
            return None
        except Exception:
            logger.warning(
                "Issue list failed for %s", repo.repo_full_name, exc_info=True
            )
            return None
    return None


def sync_open_issues(db: Session, token: str, repo: GithubRepository, *, limit: int = 100) -> int:
    """Import open GitHub issues that are not yet linked to FlowDesk tasks."""
    del token  # tokens resolved from linked connections (with project fallback)
    return backfill_open_issues(db, repo, limit=limit)


def backfill_open_issues(
    db: Session,
    repo: GithubRepository,
    *,
    limit: int = 100,
    sort: str = "created",
    direction: str = "asc",
) -> int:
    """Import a freshly-linked repo's currently-open issues as tasks + activity events.

    Webhook sync is forward-only, so without this a repo's pre-existing issues never
    appear. Run once at link time. Pull requests (returned by the issues API) are
    skipped, and issues already mapped to a task (by ``github_issue_number``) are
    skipped so it's idempotent. Best-effort: any GitHub error is swallowed so a
    transient API failure never blocks linking.
    """
    from app.services import github_api_service

    if not repo.project_id:
        return 0
    project = db.get(Project, repo.project_id)
    if not project:
        return 0
    if repo.webhook_hook_id:
        for conn in _connections_for_repo_sync(db, repo):
            hook_token = reveal(conn.access_token)
            if hook_token:
                owner, name = repo.repo_full_name.split("/", 1)
                github_api_service.ensure_flowdesk_webhook_events(
                    hook_token, owner, name, repo.webhook_hook_id
                )
                break
    issues = _fetch_open_issues_for_repo(
        db, repo, limit=limit, sort=sort, direction=direction
    )
    if issues is None:
        logger.warning(
            "Issue sync failed for %s — no valid GitHub token", repo.repo_full_name
        )
        return 0

    already = set(
        db.scalars(
            select(Task.github_issue_number).where(
                Task.project_id == repo.project_id,
                Task.github_issue_number.isnot(None),
            )
        ).all()
    )
    owner, name = repo.repo_full_name.split("/", 1)
    comment_token: str | None = None
    for conn in _connections_for_repo_sync(db, repo):
        comment_token = reveal(conn.access_token)
        if comment_token:
            break

    created = 0
    for issue in issues:
        if issue.get("pull_request"):
            continue  # the issues API also returns PRs
        number = issue.get("number")
        if number is None or number in already:
            continue
        task = _create_task_from_issue(db, repo, issue)
        if not task:
            continue
        already.add(number)
        created += 1
        task_ref = _task_ref(db, task)
        summary = f"Issue #{number} imported → task {task_ref} created"
        url = issue.get("html_url", "")
        db.add(GithubEvent(
            repository_id=repo.id,
            event_type="issues",
            action="opened",
            actor_login=(issue.get("user") or {}).get("login"),
            payload={"summary": summary, "url": url, "repo": repo.repo_full_name,
                     "title": issue.get("title"), "number": number},
            task_id=task.id,
        ))
        # Back-link: leave a "View in FlowDesk" comment on the imported issue.
        if comment_token:
            try:
                github_api_service.create_issue_comment(
                    comment_token, owner, name, number,
                    f"🔗 Tracked in FlowDesk as **{task_ref}** — "
                    f"[View in FlowDesk]({settings.FRONTEND_URL}/app/tasks/{task.id})",
                )
            except Exception:
                logger.warning("FlowDesk back-link comment failed for %s#%s",
                               repo.repo_full_name, number, exc_info=True)
    backfill_sub_issues(db, repo)
    return created


def backfill_sub_issues(db: Session, repo: GithubRepository) -> int:
    """Import GitHub sub-issues as FlowDesk subtasks for linked parent tasks."""
    if not repo.project_id:
        return 0
    owner, name = repo.repo_full_name.split("/", 1)
    token: str | None = None
    for conn in _connections_for_repo_sync(db, repo):
        token = reveal(conn.access_token)
        if token:
            break
    if not token:
        return 0

    parents = db.scalars(
        select(Task).where(
            Task.project_id == repo.project_id,
            Task.github_issue_number.isnot(None),
            Task.parent_task_id.is_(None),
            Task.deleted_at.is_(None),
        )
    ).all()
    created = 0
    for parent in parents:
        try:
            sub_issues = github_api_service.list_sub_issues(
                token, owner, name, parent.github_issue_number
            )
        except Exception:
            logger.warning(
                "Sub-issue list failed for %s#%s",
                repo.repo_full_name,
                parent.github_issue_number,
                exc_info=True,
            )
            continue
        for sub_issue in sub_issues:
            child = _create_subtask_from_github_issue(db, repo, sub_issue, parent)
            if child and child.github_issue_number == sub_issue.get("number"):
                created += 1
    return created


def sync_sub_issues_for_parent_task(
    db: Session,
    repo: GithubRepository,
    parent_task: Task,
) -> int:
    """Import GitHub sub-issues for one linked parent task (webhook fallback)."""
    if not repo.project_id or not parent_task.github_issue_number:
        return 0
    if parent_task.parent_task_id is not None:
        return 0
    owner, name = repo.repo_full_name.split("/", 1)
    token = _token_for_repo(db, repo)
    if not token:
        return 0
    try:
        sub_issues = github_api_service.list_sub_issues(
            token, owner, name, parent_task.github_issue_number
        )
    except Exception:
        logger.warning(
            "Sub-issue list failed for %s#%s",
            repo.repo_full_name,
            parent_task.github_issue_number,
            exc_info=True,
        )
        return 0
    synced = 0
    for sub_issue in sub_issues:
        enriched = _enrich_github_issue(db, repo, sub_issue)
        child = _create_subtask_from_github_issue(db, repo, enriched, parent_task)
        if child:
            synced += 1
    return synced


def sync_project_issues(db: Session, project_id: uuid.UUID, *, limit: int = 100) -> tuple[int, int]:
    """Import open GitHub issues and mirror closed/open state for linked tasks."""
    repos = db.scalars(
        select(GithubRepository).where(
            GithubRepository.project_id == project_id,
            GithubRepository.is_active.is_(True),
            GithubRepository.deleted_at.is_(None),
        )
    ).all()
    imported = 0
    for repo in repos:
        imported += backfill_open_issues(
            db, repo, limit=limit, sort="updated", direction="desc"
        )
    status_synced = sync_project_linked_issue_statuses(db, project_id)
    return imported, status_synced


FLOWDESK_COMMENT_MARKER = "<!-- flowdesk-sync -->"


def format_flowdesk_github_comment(author_name: str, body: str) -> str:
    return f"**{author_name} (FlowDesk):**\n\n{body}\n\n{FLOWDESK_COMMENT_MARKER}"


def is_flowdesk_origin_github_comment(body: str | None) -> bool:
    return FLOWDESK_COMMENT_MARKER in (body or "")


def _fallback_comment_author_id(db: Session, task: Task, project: Project) -> uuid.UUID:
    if task.created_by:
        return task.created_by
    admin_id = db.scalar(
        select(ProjectMember.user_id)
        .where(ProjectMember.project_id == project.id, ProjectMember.role == "admin")
        .limit(1)
    )
    if admin_id:
        return admin_id
    member_id = db.scalar(
        select(ProjectMember.user_id).where(ProjectMember.project_id == project.id).limit(1)
    )
    if member_id:
        return member_id
    raise ValueError(f"No project member to attribute GitHub comment on task {task.id}")


def sync_task_comment_to_github(
    db: Session,
    task: Task,
    comment_body: str,
    author_name: str,
) -> int | None:
    """Post a FlowDesk comment to the linked GitHub issue. Returns GitHub comment id."""
    if not task.github_issue_number:
        return None
    repo = _active_repo_for_task_project(db, task.project_id)
    if not repo:
        return None
    token = _token_for_repo(db, repo)
    if not token:
        return None
    owner, name = repo.repo_full_name.split("/", 1)
    gh_body = format_flowdesk_github_comment(author_name, comment_body)
    try:
        result = github_api_service.create_issue_comment(
            token, owner, name, task.github_issue_number, gh_body
        )
        gh_id = result.get("id")
        return int(gh_id) if gh_id is not None else None
    except Exception:
        logger.warning(
            "FlowDesk → GitHub comment sync failed for task %s issue #%s",
            task.id,
            task.github_issue_number,
            exc_info=True,
        )
        return None


def import_github_issue_comment(
    db: Session,
    repo: GithubRepository,
    task: Task,
    gh_comment: dict,
    *,
    actor_login: str | None = None,
) -> bool:
    """Create a FlowDesk comment from a GitHub issue comment webhook."""
    gh_id = gh_comment.get("id")
    if gh_id is None:
        return False
    existing = db.scalar(select(Comment).where(Comment.github_comment_id == int(gh_id)))
    if existing:
        return False
    raw_body = gh_comment.get("body") or ""
    if is_flowdesk_origin_github_comment(raw_body):
        return _link_flowdesk_comment_to_github_id(db, task, gh_comment)
    project = db.get(Project, repo.project_id) if repo.project_id else None
    if not project:
        return False
    try:
        author_id = _fallback_comment_author_id(db, task, project)
    except ValueError:
        logger.warning("Skipped GitHub comment import: no author for task %s", task.id)
        return False
    login = actor_login or (gh_comment.get("user") or {}).get("login")
    comment = Comment(
        task_id=task.id,
        author_id=author_id,
        body=raw_body.strip(),
        github_comment_id=int(gh_id),
        github_author_login=login,
    )
    db.add(comment)
    db.flush()
    task_service.log_task_activity(
        db,
        project,
        task,
        "comment.created",
        author_id,
        {"comment_id": str(comment.id), "source": "github"},
    )
    emit(
        "comment.created",
        task_service.task_rooms(project),
        payload={
            "comment_id": str(comment.id),
            "task_id": str(task.id),
            "author_id": str(author_id),
            "body": comment.body,
            "parent_comment_id": None,
            "github_author_login": login,
            "comment_scope": "github",
            "created_at": comment.created_at.isoformat() if comment.created_at else None,
        },
        project_id=project.id,
        workspace_id=project.workspace_id,
        task_id=task.id,
    )
    return True


_FLOWDESK_GH_COMMENT_RE = re.compile(
    r"^\*\*(.+?) \(FlowDesk\):\*\*\n\n([\s\S]*?)\n\n<!-- flowdesk-sync -->$"
)


def _extract_flowdesk_comment_body(gh_body: str) -> str | None:
    if not is_flowdesk_origin_github_comment(gh_body):
        return None
    match = _FLOWDESK_GH_COMMENT_RE.match(gh_body.strip())
    if match:
        return match.group(2)
    return gh_body.replace(FLOWDESK_COMMENT_MARKER, "").strip()


def _link_flowdesk_comment_to_github_id(db: Session, task: Task, gh_comment: dict) -> bool:
    """Attach a GitHub comment id to an existing FlowDesk comment (avoid duplicates)."""
    gh_id = gh_comment.get("id")
    if gh_id is None:
        return False
    if db.scalar(select(Comment).where(Comment.github_comment_id == int(gh_id))):
        return True
    parsed_body = _extract_flowdesk_comment_body(gh_comment.get("body") or "")
    if not parsed_body:
        return False
    local = db.scalar(
        select(Comment)
        .where(
            Comment.task_id == task.id,
            Comment.github_comment_id.is_(None),
            Comment.body == parsed_body,
            Comment.deleted_at.is_(None),
        )
        .order_by(Comment.created_at.desc())
        .limit(1)
    )
    if not local:
        return False
    local.github_comment_id = int(gh_id)
    return True


def create_synced_task_comment(
    db: Session,
    task: Task,
    project: Project,
    author_id: uuid.UUID,
    body: str,
    *,
    author_name: str,
    parent_comment_id: uuid.UUID | None = None,
) -> Comment:
    """Store a FlowDesk comment and mirror it to the linked GitHub issue."""
    comment = Comment(
        task_id=task.id,
        author_id=author_id,
        parent_comment_id=parent_comment_id,
        body=body.strip(),
    )
    db.add(comment)
    db.flush()

    gh_id = sync_task_comment_to_github(db, task, body.strip(), author_name)
    if gh_id:
        comment.github_comment_id = gh_id

    task_service.log_task_activity(
        db,
        project,
        task,
        "comment.created",
        author_id,
        {"comment_id": str(comment.id)},
    )
    emit(
        "comment.created",
        task_service.task_rooms(project),
        payload={
            "comment_id": str(comment.id),
            "task_id": str(task.id),
            "author_id": str(author_id),
            "body": comment.body,
            "parent_comment_id": str(parent_comment_id) if parent_comment_id else None,
            "comment_scope": "github",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        project_id=project.id,
        workspace_id=project.workspace_id,
        task_id=task.id,
    )
    return comment


def sync_issue_comments_for_task(
    db: Session,
    repo: GithubRepository,
    task: Task,
) -> int:
    """Pull GitHub issue comments into FlowDesk (webhook fallback)."""
    if not task.github_issue_number or not repo.project_id:
        return 0
    token = _token_for_repo(db, repo)
    if not token:
        return 0
    owner, name = repo.repo_full_name.split("/", 1)
    try:
        gh_comments = github_api_service.list_issue_comments(
            token, owner, name, int(task.github_issue_number)
        )
    except Exception:
        logger.warning(
            "GitHub issue comment list failed for %s#%s",
            repo.repo_full_name,
            task.github_issue_number,
            exc_info=True,
        )
        return 0
    synced = 0
    for gh_comment in gh_comments:
        if import_github_issue_comment(
            db, repo, task, gh_comment, actor_login=(gh_comment.get("user") or {}).get("login")
        ):
            synced += 1
    return synced
