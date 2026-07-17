"""GitHub issue title format for FlowDesk ↔ GitHub two-way sync.

Outbound (FlowDesk → GitHub): ``{project_name}/{task_title}``
Inbound (GitHub → FlowDesk): strip the project prefix when it matches; also accept
legacy ``{task_ref}: {task_title}`` titles from older links.
"""
from __future__ import annotations

import re

from app.core.task_ref import TASK_REF_RE

_LEGACY_REF_TITLE_RE = re.compile(
    r"^([A-F0-9]{8}-\d+|[A-Z][A-Z0-9]{1,9}-\d+)\s*:\s*(.+)$"
)


def format_github_issue_title(project_name: str, task_title: str) -> str:
    project = project_name.strip()
    title = task_title.strip() or "Untitled"
    return f"{project}/{title}"


def parse_github_issue_task_title(issue_title: str, project_name: str | None = None) -> str:
    """Extract the FlowDesk task title from a GitHub issue title."""
    raw = (issue_title or "").strip()
    if not raw:
        return "Untitled"

    legacy = _LEGACY_REF_TITLE_RE.match(raw)
    if legacy:
        parsed = legacy.group(2).strip()
        return parsed or raw

    project = (project_name or "").strip()
    if project:
        prefix = f"{project}/"
        if raw.startswith(prefix):
            parsed = raw[len(prefix) :].strip()
            return parsed or raw

    if "/" in raw and project:
        left, right = raw.split("/", 1)
        if left.strip() == project:
            parsed = right.strip()
            return parsed or raw

    return raw


def issue_title_matches_task(issue_title: str, project_name: str, task_title: str) -> bool:
    """True when a GitHub issue title represents the given FlowDesk task."""
    return parse_github_issue_task_title(issue_title, project_name) == task_title.strip()
