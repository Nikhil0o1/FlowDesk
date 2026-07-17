"""GitHub issue body format for FlowDesk ↔ GitHub description sync.

Outbound bodies include a FlowDesk header/footer so GitHub issues stay linked.
Inbound sync strips that boilerplate so only the user's description is stored on tasks.
"""
from __future__ import annotations

import re

from app.core.config import settings

_VIEW_LINK_TRAILER_RE = re.compile(
    r"\n*\[View in FlowDesk\]\([^)]+\)\s*$",
    re.IGNORECASE,
)


def format_github_issue_body(
    *,
    task_ref: str,
    title: str,
    description: str | None,
    task_id,
) -> str:
    """Build a GitHub issue body from a FlowDesk task."""
    parts = [f"Linked to FlowDesk task **{task_ref}**: {title}"]
    if description and description.strip():
        parts.extend(["", description.strip()])
    parts.extend(["", f"[View in FlowDesk]({settings.FRONTEND_URL}/app/tasks/{task_id})"])
    return "\n".join(parts).strip()


def parse_github_issue_description(body: str | None) -> str | None:
    """Extract the user-authored description from a GitHub issue body."""
    if not body or not body.strip():
        return None
    text = body.strip()
    lines = text.splitlines()
    if lines and lines[0].startswith("Linked to FlowDesk task"):
        text = "\n".join(lines[1:]).strip()
    text = _VIEW_LINK_TRAILER_RE.sub("", text).strip()
    return text or None
