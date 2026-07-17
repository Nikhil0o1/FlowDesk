"""Verify the database schema matches the application migration head."""
from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from app.core.config import settings
from app.db.session import engine

logger = logging.getLogger(__name__)


def migration_status() -> tuple[str | None, str | None]:
    """Return (current_revision, head_revision).

    When the DB has multiple applied heads (parallel branches), ``current`` is
    a comma-separated list so startup checks can still compare against the
    single script head after a merge migration exists.
    """
    alembic_ini = Path(__file__).resolve().parents[2] / "alembic.ini"
    script = ScriptDirectory.from_config(Config(str(alembic_ini)))

    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        try:
            current = context.get_current_revision()
        except Exception:
            # Multiple rows in alembic_version — treat as "not at single head".
            heads = context.get_current_heads()
            current = ",".join(sorted(heads)) if heads else None

    heads = script.get_heads()
    head = heads[0] if len(heads) == 1 else ",".join(sorted(heads))
    return current, head


def ensure_migrations_current() -> None:
    """Warn or fail when pending Alembic migrations would break API queries."""
    current, head = migration_status()
    if current == head:
        return

    msg = (
        f"Database schema is out of date (revision={current!r}, head={head!r}). "
        "Run: alembic upgrade head"
    )
    if settings.is_production:
        raise RuntimeError(msg)

    logger.warning("%s — auto-upgrading in development", msg)
    subprocess.check_call([sys.executable, "-m", "alembic", "upgrade", "head"])
    current, head = migration_status()
    if current != head:
        raise RuntimeError(
            f"Migration auto-upgrade failed (revision={current!r}, head={head!r})"
        )
    logger.info("Database migrated to head (%s)", head)
