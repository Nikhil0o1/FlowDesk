#!/usr/bin/env bash
# Wipes the local FlowDesk database and rebuilds it from scratch.
# Run from the repo root: bash scripts/reset_local_db.sh
set -euo pipefail

DB_NAME="flowdesk"
DB_USER="postgres"
DB_HOST="localhost"
DB_PORT="5432"

echo "Dropping schema..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" \
  -c "GRANT ALL ON SCHEMA public TO $DB_USER;" \
  -c "GRANT ALL ON SCHEMA public TO public;"

echo "Running migrations..."
python3 -m alembic upgrade head

echo "Seeding demo data..."
python3 seed.py

echo "Done. Sign in via email OTP with owner@acme.dev, admin@acme.dev, maria@acme.dev or dev@acme.dev"
