"""Build a customer-safe OpenAPI document containing only @pat_allow routes."""

from __future__ import annotations

from typing import Any

from app.core.pat_route_registry import collect_pat_routes, endpoint_pat_meta


def _pat_path_method_set(app: Any) -> set[tuple[str, str]]:
    allowed: set[tuple[str, str]] = set()
    for row in collect_pat_routes(app):
        for method in row["methods"]:
            allowed.add((row["path"], method.upper()))
    return allowed


def build_public_openapi(app: Any) -> dict[str, Any]:
    """
    Return OpenAPI 3 schema filtered to PAT-enabled routes only.

    Adds x-flowdesk-scopes and x-flowdesk-rate-category from @pat_allow metadata.
    """
    schema = app.openapi()
    allowed = _pat_path_method_set(app)

    # Index endpoint metadata by (path, method)
    meta_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for route in getattr(app, "routes", []):
        endpoint = getattr(route, "endpoint", None)
        meta = endpoint_pat_meta(endpoint)
        if meta is None:
            continue
        path = getattr(route, "path", "")
        for method in getattr(route, "methods", set()) or set():
            if method == "HEAD":
                continue
            meta_by_key[(path, method.upper())] = meta

    filtered_paths: dict[str, Any] = {}
    for path, methods in (schema.get("paths") or {}).items():
        kept: dict[str, Any] = {}
        for method, operation in methods.items():
            if method.startswith("x-"):
                continue
            key = (path, method.upper())
            if key not in allowed:
                continue
            op = dict(operation)
            meta = meta_by_key.get(key)
            if meta:
                op["x-flowdesk-scopes"] = sorted(meta["scopes"])
                op["x-flowdesk-rate-category"] = meta["rate_category"]
                op["x-flowdesk-authz-class"] = meta["authz_class"]
                op["security"] = [{"ApiKeyBearer": []}]
            kept[method] = op
        if kept:
            filtered_paths[path] = kept

    used_refs: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
                used_refs.add(ref.rsplit("/", 1)[-1])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(filtered_paths)

    components = schema.get("components") or {}
    all_schemas = components.get("schemas") or {}
    # Closure over nested refs
    changed = True
    while changed:
        changed = False
        for name in list(used_refs):
            before = len(used_refs)
            walk(all_schemas.get(name))
            if len(used_refs) > before:
                changed = True

    filtered_schemas = {k: v for k, v in all_schemas.items() if k in used_refs}

    return {
        "openapi": schema.get("openapi", "3.1.0"),
        "info": {
            "title": "FlowDesk Public API",
            "version": schema.get("info", {}).get("version", "1.0.0"),
            "description": (
                "Customer-facing API reference for personal API keys (PATs). "
                "Only endpoints that accept API-key authentication are included. "
                "Internal JWT-only and admin routes are omitted. "
                "Phase 1 scopes are operation-level only — workspace/project key "
                "restrictions are not available."
            ),
        },
        "servers": schema.get("servers")
        or [{"url": "/api/v1", "description": "FlowDesk API v1"}],
        "paths": filtered_paths,
        "components": {
            "schemas": filtered_schemas,
            "securitySchemes": {
                "ApiKeyBearer": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "API key",
                    "description": (
                        "Personal API key (`fd_live_…`). Pass as "
                        "`Authorization: Bearer <key>`. Never place keys in query strings."
                    ),
                }
            },
        },
        "tags": schema.get("tags") or [],
    }


def public_rate_limit_catalog() -> list[dict[str, Any]]:
    from app.core.pat_rate_limit import CATEGORY_LIMITS

    return [
        {
            "category": category,
            "limit": limit,
            "window_seconds": window,
            "algorithm": "fixed_window",
        }
        for category, (limit, window) in sorted(CATEGORY_LIMITS.items())
    ]
