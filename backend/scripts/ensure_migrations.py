"""Repair alembic_version when the DB schema exists but was never stamped.

Render (and manual schema bootstraps) can leave a fully-built database with an
empty alembic_version table. The next `alembic upgrade head` then re-runs the
initial migration and fails with DuplicateTable. This module detects that state
and stamps the schema's revision (in-process) before migrations run.

Production may also hold revision IDs that were removed from a later branch merge
(e.g. ``chatdmprefs01``). Those are re-stamped to the nearest equivalent revision
in the current graph using schema fingerprints — no data is dropped.
"""
from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import Engine, inspect, text

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

HEAD_MARKER_TABLE = "revoked_access_tokens"


def _alembic_ini() -> Path:
    return _ROOT / "alembic.ini"


def _script_directory():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(Config(str(_alembic_ini())))


def _column_names(inspector, table: str) -> set[str]:
    if table not in set(inspector.get_table_names()):
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _revision_exists(script, revision: str) -> bool:
    try:
        script.get_revision(revision)
        return True
    except Exception:
        return False


def _orphan_stamp_target(revision: str, inspector) -> str | None:
    """Map removed revision IDs to a stamp target in the current graph."""
    chat_member_cols = _column_names(inspector, "chat_members")
    sprint_cols = _column_names(inspector, "sprints")

    if revision == "chatdmprefs01":
        if "closed_at" in chat_member_cols and "is_favorite" in chat_member_cols:
            return "chatdmprefs01" if _revision_exists(_script_directory(), "chatdmprefs01") else "chatattach01"
        return "chatattach01"

    if revision == "c7mergeheads":
        return "chatattach01"

    if revision == "b4fcd7e01de5":
        return "wbprojgench01"

    if revision == "q4r5s6t7u8v9":
        if "delegate_scrum_master_id" not in sprint_cols and "scope_locked" not in sprint_cols:
            return "p3q4r5s6t7u8"
        return "wbprojgench01"

    return None


def _target_revision(engine: Engine, inspector) -> str:
    """Return the revision the *current* schema is at, so alembic can apply the rest."""
    script = _script_directory()
    head = script.get_current_head()
    tables = set(inspector.get_table_names())

    if "documents" in tables and "user_presence" in tables:
        return head

    chat_cols = _column_names(inspector, "chat_channels")
    if "is_general" in chat_cols:
        chat_member_cols = _column_names(inspector, "chat_members")
        if "closed_at" in chat_member_cols and _revision_exists(script, "chatdmprefs01"):
            return "chatdmprefs01"
        if _revision_exists(script, "chatattach01"):
            return "chatattach01"

    parent = script.get_revision(head).down_revision
    if isinstance(parent, (tuple, list)):
        parent = parent[0]
    return parent or head


def _write_revision(engine: Engine, revision: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM alembic_version"))
        conn.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:rev)"),
            {"rev": revision},
        )


def repair_if_needed(engine: Engine) -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    if "alembic_version" not in tables:
        print("ensure_migrations: fresh database — leaving alembic to migrate normally")
        return

    script = _script_directory()

    with engine.connect() as conn:
        versions = [row[0] for row in conn.execute(text("SELECT version_num FROM alembic_version"))]

    if not versions:
        if "users" not in tables or HEAD_MARKER_TABLE not in tables:
            print("ensure_migrations: schema incomplete — leaving alembic to migrate normally")
            return

        target = _target_revision(engine, inspector)
        print(
            f"ensure_migrations: schema exists but alembic_version is empty — "
            f"stamping {target} in-process (no subprocess)"
        )
        _write_revision(engine, target)
        return

    unknown = [rev for rev in versions if not _revision_exists(script, rev)]
    if unknown:
        if len(unknown) != 1:
            print(f"ensure_migrations: unsupported alembic_version rows {versions!r} — manual repair needed")
            return

        orphan = unknown[0]
        target = _orphan_stamp_target(orphan, inspector)
        if target is None:
            print(f"ensure_migrations: unknown revision {orphan!r} — cannot auto-stamp")
            return

        print(f"ensure_migrations: remapping orphan revision {orphan!r} -> {target!r} (schema preserved)")
        _write_revision(engine, target)


def main() -> None:
    from sqlalchemy import create_engine

    from app.core.config import settings

    repair_if_needed(create_engine(settings.DATABASE_URL))


if __name__ == "__main__":
    main()
