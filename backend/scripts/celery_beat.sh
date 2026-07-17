#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec celery -A celery_app.app beat --loglevel="${LOG_LEVEL:-info}"
