#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CONCURRENCY="${CELERY_WORKER_CONCURRENCY:-4}"
exec celery -A celery_app.app worker \
  -Q default,scheduled,fast \
  --concurrency="${CONCURRENCY}" \
  --loglevel="${LOG_LEVEL:-info}"
