#!/usr/bin/env python3
"""Fail if generated PAT registry markdown drifts from live @pat_allow routes."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("DEBUG", "true")
os.environ.setdefault("SECRET_KEY", "inventory-script-only")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")
os.environ.setdefault("BACKEND_URL", "http://localhost:8000")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://flowdesk:flowdesk@localhost:5432/flowdesk")
os.environ.setdefault("MICROSOFT_TENANT", "common")
os.environ.setdefault("STORAGE_BACKEND", "local")
os.environ.setdefault("API_KEY_PEPPERS", '{"1":"inventory-pepper"}')
os.environ.setdefault("API_KEY_PEPPER_CURRENT", "1")

from app.core.config import get_settings

get_settings.cache_clear()

from app.core.pat_route_registry import (  # noqa: E402
    collect_pat_routes,
    render_pat_inventory_markdown,
    validate_pat_inventory,
)
from app.core.public_openapi import build_public_openapi  # noqa: E402
from app.main import app  # noqa: E402


def main() -> int:
    rows = collect_pat_routes(app)
    validate_pat_inventory(rows)
    expected = render_pat_inventory_markdown(rows)
    path = ROOT / "docs" / "api" / "pat_route_registry.md"
    actual = path.read_text(encoding="utf-8") if path.exists() else ""
    if actual != expected:
        print("ERROR: pat_route_registry.md is out of date. Run:")
        print("  python scripts/generate_pat_route_registry.py")
        return 1

    doc = build_public_openapi(app)
    openapi_paths = set(doc["paths"].keys())
    registry_paths = {r["path"] for r in rows}
    if openapi_paths != registry_paths:
        missing = registry_paths - openapi_paths
        extra = openapi_paths - registry_paths
        print("ERROR: public OpenAPI paths drift from PAT registry")
        if missing:
            print("  missing from OpenAPI:", sorted(missing))
        if extra:
            print("  extra in OpenAPI:", sorted(extra))
        return 1

    for path_key, methods in doc["paths"].items():
        for method, op in methods.items():
            if method.startswith("x-"):
                continue
            scopes = op.get("x-flowdesk-scopes") or []
            if not scopes:
                print(f"ERROR: {method.upper()} {path_key} lacks x-flowdesk-scopes")
                return 1

    print(f"OK: registry + public OpenAPI aligned ({len(rows)} routes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
