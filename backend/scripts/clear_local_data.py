"""Truncate all application data; keep schema and alembic_version."""
from sqlalchemy import create_engine, text

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL)
with engine.begin() as conn:
    tables = conn.execute(
        text(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename != 'alembic_version' "
            "ORDER BY tablename"
        )
    ).scalars().all()
    if not tables:
        print("No user tables found (database may already be empty).")
    else:
        quoted = ", ".join(f'"{t}"' for t in tables)
        conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
        print(f"Cleared data from {len(tables)} tables (schema + alembic_version kept).")
        for name in tables:
            print(f"  - {name}")
