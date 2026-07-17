#!/usr/bin/env bash
# Stop the MCP sidecar started by start_mcp_sidecar.sh.
set -euo pipefail

PID_FILE="${MCP_PID_FILE:-/tmp/flowdesk-mcp-sidecar.pid}"

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "Stopped MCP sidecar (pid $pid)"
  fi
  rm -f "$PID_FILE"
fi
