#!/usr/bin/env bash
# Wipes the Render FlowDesk database and rebuilds it from scratch.
# Run from the repo root: RENDER_DB_URL="postgresql://..." bash scripts/reset_render_db.sh
set -euo pipefail

if [[ -z "${RENDER_DB_URL:-}" ]]; then
  echo "Error: RENDER_DB_URL is not set."
  echo "Usage: RENDER_DB_URL=\"postgresql://user:pass@host/db\" bash scripts/reset_render_db.sh"
  exit 1
fi

echo "Dropping schema on Render..."
psql "$RENDER_DB_URL" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" \
  -c "GRANT ALL ON SCHEMA public TO CURRENT_USER;" \
  -c "GRANT ALL ON SCHEMA public TO public;"

echo "Running migrations..."
DATABASE_URL="$RENDER_DB_URL" python3 -m alembic upgrade head

echo "Seeding demo data..."
DATABASE_URL="$RENDER_DB_URL" python3 seed.py

echo "Done. Sign in via email OTP with owner@acme.dev, admin@acme.dev, maria@acme.dev or dev@acme.dev"
