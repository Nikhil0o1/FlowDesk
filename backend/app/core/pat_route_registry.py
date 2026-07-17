"""PAT route allowlist metadata attached to endpoint functions."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal, TypeVar

from app.core.api_token_scopes import ALL_SCOPES

F = TypeVar("F", bound=Callable[..., Any])

AuthzClass = Literal["principal", "tenant", "workspace", "project", "object"]
RateCategory = Literal["standard", "standard_write", "expensive_read"]

PAT_ENABLED_ATTR = "__pat_enabled__"
PAT_SCOPES_ATTR = "__pat_required_scopes__"
PAT_RATE_ATTR = "__pat_rate_category__"
PAT_AUTHZ_ATTR = "__pat_authz_class__"
PAT_TENANT_DOC_ATTR = "__pat_tenant_resolution__"

VALID_AUTHZ = frozenset({"principal", "tenant", "workspace", "project", "object"})
VALID_RATE = frozenset({"standard", "standard_write", "expensive_read"})


def pat_allow(
    *scopes: str,
    rate_category: RateCategory = "standard",
    authz_class: AuthzClass,
    tenant_resolution: str = "",
) -> Callable[[F], F]:
    """Mark an endpoint as PAT-enabled. Requires at least one explicit scope."""
    if not scopes:
        raise ValueError("pat_allow requires at least one scope")
    unknown = [s for s in scopes if s not in ALL_SCOPES]
    if unknown:
        raise ValueError(f"Unknown PAT scope(s): {', '.join(unknown)}")
    if authz_class not in VALID_AUTHZ:
        raise ValueError(f"Invalid authz_class: {authz_class}")
    if rate_category not in VALID_RATE:
        raise ValueError(f"Invalid rate_category: {rate_category}")

    required = frozenset(scopes)

    def decorator(func: F) -> F:
        setattr(func, PAT_ENABLED_ATTR, True)
        setattr(func, PAT_SCOPES_ATTR, required)
        setattr(func, PAT_RATE_ATTR, rate_category)
        setattr(func, PAT_AUTHZ_ATTR, authz_class)
        setattr(func, PAT_TENANT_DOC_ATTR, tenant_resolution)
        return func

    return decorator


def endpoint_pat_meta(endpoint: Any) -> dict[str, Any] | None:
    if endpoint is None:
        return None
    if not getattr(endpoint, PAT_ENABLED_ATTR, False):
        return None
    return {
        "scopes": getattr(endpoint, PAT_SCOPES_ATTR, frozenset()),
        "rate_category": getattr(endpoint, PAT_RATE_ATTR, "standard"),
        "authz_class": getattr(endpoint, PAT_AUTHZ_ATTR, "principal"),
        "tenant_resolution": getattr(endpoint, PAT_TENANT_DOC_ATTR, ""),
    }


def collect_pat_routes(app: Any) -> list[dict[str, Any]]:
    """Iterate FastAPI registered routes and collect PAT-enabled endpoints."""
    rows: list[dict[str, Any]] = []
    for route in getattr(app, "routes", []):
        endpoint = getattr(route, "endpoint", None)
        meta = endpoint_pat_meta(endpoint)
        if meta is None:
            continue
        methods = sorted(m for m in getattr(route, "methods", set()) or set() if m != "HEAD")
        rows.append(
            {
                "path": getattr(route, "path", ""),
                "methods": methods,
                "name": getattr(route, "name", ""),
                "endpoint": getattr(endpoint, "__name__", str(endpoint)),
                "scopes": sorted(meta["scopes"]),
                "rate_category": meta["rate_category"],
                "authz_class": meta["authz_class"],
                "tenant_resolution": meta["tenant_resolution"],
            }
        )
    rows.sort(key=lambda r: (r["path"], ",".join(r["methods"])))
    return rows


def render_pat_inventory_markdown(rows: list[dict[str, Any]]) -> str:
    lines = [
        "# PAT route registry",
        "",
        "Generated from FastAPI routes that declare `@pat_allow`.",
        "",
        "| Methods | Path | Scopes | Authz class | Rate | Tenant resolution |",
        "|---------|------|--------|-------------|------|-------------------|",
    ]
    for r in rows:
        lines.append(
            f"| {', '.join(r['methods'])} | `{r['path']}` | {', '.join(r['scopes'])} "
            f"| {r['authz_class']} | {r['rate_category']} | {r['tenant_resolution'] or '—'} |"
        )
    lines.append("")
    lines.append(
        "> Phase 1 PAT scopes restrict operations but not individual workspaces or projects. "
        "Resource restrictions are not supported."
    )
    lines.append("")
    return "\n".join(lines)


def validate_pat_inventory(rows: list[dict[str, Any]]) -> None:
    for r in rows:
        if not r["scopes"]:
            raise ValueError(f"PAT route {r['path']} has no scopes")
        if r["authz_class"] not in VALID_AUTHZ:
            raise ValueError(f"PAT route {r['path']} has invalid authz_class")
