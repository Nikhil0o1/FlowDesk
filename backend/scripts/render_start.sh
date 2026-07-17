#!/usr/bin/env bash
# Render start command — MCP sidecar (optional) + Gunicorn on $PORT.
set -euo pipefail

cleanup() {
  bash scripts/stop_mcp_sidecar.sh || true
}
trap cleanup EXIT INT TERM

bash scripts/start_mcp_sidecar.sh

exec gunicorn app.main:app -c gunicorn_conf.py
