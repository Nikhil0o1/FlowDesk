#!/usr/bin/env bash
# Render build command — install deps and migrate. Do not start the web server here.
set -euo pipefail

pip install -r requirements.txt

# One-time DB reset — drops and recreates the public schema, then rebuilds from scratch.
# Set RESET_DB_ON_DEPLOY=true for exactly one deploy, then remove the flag.
if [ "${RESET_DB_ON_DEPLOY:-false}" = "true" ]; then
  echo ">>> RESET_DB_ON_DEPLOY=true: dropping schema and rebuilding from scratch"
  python - <<'PYEOF'
from sqlalchemy import create_engine, text
from app.core.config import settings
engine = create_engine(settings.DATABASE_URL)
with engine.connect() as conn:
    conn.execute(text("DROP SCHEMA public CASCADE"))
    conn.execute(text("CREATE SCHEMA public"))
    conn.commit()
print("Schema reset done.")
PYEOF
  alembic upgrade head
else
  PYTHONPATH="${PYTHONPATH:+$PYTHONPATH:}." python scripts/ensure_migrations.py
  alembic upgrade head
fi

if [ "${SEED_ON_DEPLOY:-false}" = "true" ]; then
  echo ">>> SEED_ON_DEPLOY=true: running seed.py"
  python seed.py
else
  echo "Skipping seed (set SEED_ON_DEPLOY=true to run seed.py on deploy)"
fi

bash scripts/build_mcp_sidecar.sh
