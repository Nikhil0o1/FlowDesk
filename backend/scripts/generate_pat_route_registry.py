#!/usr/bin/env python3
"""Generate backend/docs/api/pat_route_registry.md from the FastAPI app."""

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
from app.main import app  # noqa: E402


def main() -> int:
    rows = collect_pat_routes(app)
    validate_pat_inventory(rows)
    out = ROOT / "docs" / "api" / "pat_route_registry.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_pat_inventory_markdown(rows), encoding="utf-8")
    print(f"Wrote {out} ({len(rows)} routes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
