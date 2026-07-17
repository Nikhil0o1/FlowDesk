"""Scopes for personal access tokens (PAT) used by MCP and automation clients.

Strict implication rules: write does NOT imply read.
No cross-resource implications (projects:read does not imply organizations:read).
New token creation defaults to an empty scope list — clients must request scopes explicitly.
"""

from __future__ import annotations

# Phase 1 — public PAT surface
SCOPE_PROFILE_READ = "profile:read"
SCOPE_ORGANIZATIONS_READ = "organizations:read"
SCOPE_TASKS_READ = "tasks:read"
SCOPE_TASKS_WRITE = "tasks:write"
SCOPE_PROJECTS_READ = "projects:read"
SCOPE_COMMENTS_READ = "comments:read"
SCOPE_COMMENTS_WRITE = "comments:write"
SCOPE_SEARCH_READ = "search:read"
SCOPE_TIME_READ = "time:read"
SCOPE_TIME_WRITE = "time:write"
SCOPE_MCP_AUDIT = "mcp:audit"
SCOPE_REALTIME_READ = "realtime:read"
SCOPE_REALTIME_WRITE = "realtime:write"

# Reserved for future allowlist expansion (not Phase 1 routes)
SCOPE_INBOX_READ = "inbox:read"
SCOPE_INBOX_WRITE = "inbox:write"
SCOPE_SPRINTS_READ = "sprints:read"
SCOPE_SPRINTS_WRITE = "sprints:write"
SCOPE_MEMBERS_READ = "members:read"
SCOPE_TEMPLATES_READ = "templates:read"
SCOPE_TEMPLATES_WRITE = "templates:write"
SCOPE_CHAT_READ = "chat:read"
SCOPE_CHAT_WRITE = "chat:write"
SCOPE_DOCS_READ = "docs:read"
SCOPE_DOCS_WRITE = "docs:write"
SCOPE_FORMS_READ = "forms:read"
SCOPE_WHITEBOARDS_READ = "whiteboards:read"
SCOPE_GITHUB_READ = "github:read"
SCOPE_GITHUB_WRITE = "github:write"

PHASE1_SCOPES: frozenset[str] = frozenset(
    {
        SCOPE_PROFILE_READ,
        SCOPE_ORGANIZATIONS_READ,
        SCOPE_TASKS_READ,
        SCOPE_TASKS_WRITE,
        SCOPE_PROJECTS_READ,
        SCOPE_COMMENTS_READ,
        SCOPE_COMMENTS_WRITE,
        SCOPE_SEARCH_READ,
        SCOPE_TIME_READ,
        SCOPE_TIME_WRITE,
        SCOPE_MCP_AUDIT,
        SCOPE_REALTIME_READ,
        SCOPE_REALTIME_WRITE,
    }
)

ALL_SCOPES: frozenset[str] = frozenset(
    {
        *PHASE1_SCOPES,
        SCOPE_INBOX_READ,
        SCOPE_INBOX_WRITE,
        SCOPE_SPRINTS_READ,
        SCOPE_SPRINTS_WRITE,
        SCOPE_MEMBERS_READ,
        SCOPE_TEMPLATES_READ,
        SCOPE_TEMPLATES_WRITE,
        SCOPE_CHAT_READ,
        SCOPE_CHAT_WRITE,
        SCOPE_DOCS_READ,
        SCOPE_DOCS_WRITE,
        SCOPE_FORMS_READ,
        SCOPE_WHITEBOARDS_READ,
        SCOPE_GITHUB_READ,
        SCOPE_GITHUB_WRITE,
    }
)

# Issuance default: no scopes. Callers must pass an explicit list (consent / OAuth).
DEFAULT_CREATE_SCOPES: list[str] = []

# Deprecated alias — do not use for issuance; kept so tests/importers fail loudly if misused.
DEFAULT_MCP_SCOPES: list[str] = []


def normalize_scopes(scopes: list[str] | None) -> list[str]:
    """Normalize scopes. None or empty → []. Unknown scopes raise ValueError."""
    if not scopes:
        return []
    unknown = [s for s in scopes if s not in ALL_SCOPES]
    if unknown:
        raise ValueError(f"Unknown scope(s): {', '.join(unknown)}")
    return sorted(set(scopes))


def scopes_satisfy(have: list[str], required: str) -> bool:
    return required in have


def scopes_satisfy_all(have: list[str] | set[str], required: frozenset[str] | set[str]) -> bool:
    have_set = set(have)
    return required.issubset(have_set)
