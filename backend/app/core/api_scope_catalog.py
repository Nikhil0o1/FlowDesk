"""Public-safe metadata for API key scopes (JWT-only endpoints)."""

from __future__ import annotations

from app.core.api_token_scopes import (
    SCOPE_COMMENTS_READ,
    SCOPE_COMMENTS_WRITE,
    SCOPE_MCP_AUDIT,
    SCOPE_ORGANIZATIONS_READ,
    SCOPE_PROFILE_READ,
    SCOPE_PROJECTS_READ,
    SCOPE_REALTIME_READ,
    SCOPE_REALTIME_WRITE,
    SCOPE_SEARCH_READ,
    SCOPE_TASKS_READ,
    SCOPE_TASKS_WRITE,
    SCOPE_TIME_READ,
    SCOPE_TIME_WRITE,
    PHASE1_SCOPES,
)

# Safe public descriptions — no internal implementation details.
PHASE1_SCOPE_CATALOG: list[dict[str, str]] = [
    {
        "scope": SCOPE_PROFILE_READ,
        "group": "Identity",
        "name": "Read profile",
        "description": "Read your basic FlowDesk profile identity (e.g. GET /auth/me).",
        "access": "read",
    },
    {
        "scope": SCOPE_ORGANIZATIONS_READ,
        "group": "Organizations and projects",
        "name": "List organizations",
        "description": "List organizations you belong to.",
        "access": "read",
    },
    {
        "scope": SCOPE_PROJECTS_READ,
        "group": "Organizations and projects",
        "name": "Read projects",
        "description": "List and view workspaces, projects, and project statuses you can access.",
        "access": "read",
    },
    {
        "scope": SCOPE_TASKS_READ,
        "group": "Tasks",
        "name": "Read tasks",
        "description": "View tasks you are already permitted to access. Does not allow creating or modifying tasks.",
        "access": "read",
    },
    {
        "scope": SCOPE_TASKS_WRITE,
        "group": "Tasks",
        "name": "Write tasks",
        "description": "Create and modify tasks where you already have permission. Does not allow reading tasks unless tasks:read is also granted.",
        "access": "write",
    },
    {
        "scope": SCOPE_COMMENTS_READ,
        "group": "Comments",
        "name": "Read comments",
        "description": "List comments on tasks you can access.",
        "access": "read",
    },
    {
        "scope": SCOPE_COMMENTS_WRITE,
        "group": "Comments",
        "name": "Write comments",
        "description": "Add comments on tasks you can access. Does not allow reading comments unless comments:read is also granted.",
        "access": "write",
    },
    {
        "scope": SCOPE_SEARCH_READ,
        "group": "Search",
        "name": "Search",
        "description": "Search across resources visible to you.",
        "access": "read",
    },
    {
        "scope": SCOPE_TIME_READ,
        "group": "Time tracking",
        "name": "Read time entries",
        "description": "View your timers and time entries.",
        "access": "read",
    },
    {
        "scope": SCOPE_TIME_WRITE,
        "group": "Time tracking",
        "name": "Write time entries",
        "description": "Log time and start/stop timers. Does not allow reading time data unless time:read is also granted.",
        "access": "write",
    },
    {
        "scope": SCOPE_MCP_AUDIT,
        "group": "MCP",
        "name": "MCP tool audit",
        "description": "Allow the MCP sidecar to record its own tool-invocation activity for your connection. This is not organization-wide administrative audit-log access.",
        "access": "write",
    },
    {
        "scope": SCOPE_REALTIME_READ,
        "group": "Realtime",
        "name": "Realtime read",
        "description": "Connect to the Integration WebSocket, receive live events, and subscribe/unsubscribe to rooms you can access.",
        "access": "read",
    },
    {
        "scope": SCOPE_REALTIME_WRITE,
        "group": "Realtime",
        "name": "Realtime write",
        "description": "Reserved for client→server mutating realtime commands beyond ping/subscribe. Currently same connection as realtime:read; grant when you need write-capable realtime clients.",
        "access": "write",
    },
]


def public_scope_catalog() -> list[dict[str, str]]:
    """Return Phase 1 scope metadata only (safe for the UI / docs)."""
    return [row for row in PHASE1_SCOPE_CATALOG if row["scope"] in PHASE1_SCOPES]
