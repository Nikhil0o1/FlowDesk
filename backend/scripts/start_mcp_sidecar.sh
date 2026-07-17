#!/usr/bin/env bash
# Start the Node MCP HTTP server on localhost (colocated with the API).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_DIR="${MCP_DIR:-$BACKEND_DIR/mcp}"
MCP_INTERNAL_PORT="${MCP_INTERNAL_PORT:-3100}"
PID_FILE="${MCP_PID_FILE:-/tmp/flowdesk-mcp-sidecar.pid}"

if ! bash "$SCRIPT_DIR/mcp_colocated_enabled.sh"; then
  exit 0
fi

if [ ! -f "$MCP_DIR/dist/http.js" ]; then
  echo "MCP dist/http.js missing — cannot start sidecar" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found — cannot start MCP sidecar" >&2
  exit 1
fi

# Must match CANONICAL_BACKEND_URL in app/core/config.py.
CANONICAL_BACKEND_URL="https://flowdesk-api-mvwt.onrender.com"

is_loopback_url() {
  case "$1" in
    http://localhost*|https://localhost*|http://127.0.0.1*|https://127.0.0.1*) return 0 ;;
    *) return 1 ;;
  esac
}

API_PORT="${PORT:-8000}"
export FLOWDESK_API_URL="http://127.0.0.1:${API_PORT}"
export MCP_BIND_HOST="127.0.0.1"
export MCP_PORT="$MCP_INTERNAL_PORT"

# Public backend origin advertised in OAuth metadata (FLOWDESK_API_URL stays internal).
PUBLIC_BACKEND="${BACKEND_URL:-}"
if [ "${ENVIRONMENT:-}" = "production" ] && { [ -z "$PUBLIC_BACKEND" ] || is_loopback_url "$PUBLIC_BACKEND"; }; then
  PUBLIC_BACKEND="$CANONICAL_BACKEND_URL"
fi
if [ -n "$PUBLIC_BACKEND" ]; then
  export FLOWDESK_PUBLIC_BACKEND_URL="${PUBLIC_BACKEND%/}"
fi

# Public URL for OAuth metadata + icons — defaults to the public backend when MCP_PUBLIC_URL unset.
if [ -n "${MCP_PUBLIC_URL:-}" ]; then
  export MCP_PUBLIC_URL="${MCP_PUBLIC_URL%/}"
elif [ -n "$PUBLIC_BACKEND" ]; then
  export MCP_PUBLIC_URL="${PUBLIC_BACKEND%/}"
else
  export MCP_PUBLIC_URL="http://localhost:3100"
fi
# Never advertise loopback MCP URLs in production.
if [ "${ENVIRONMENT:-}" = "production" ] && is_loopback_url "$MCP_PUBLIC_URL"; then
  export MCP_PUBLIC_URL="${PUBLIC_BACKEND%/}"
fi

echo "Starting MCP sidecar on 127.0.0.1:${MCP_INTERNAL_PORT} (public ${MCP_PUBLIC_URL}/mcp) ..."
node "$MCP_DIR/dist/http.js" &
echo $! >"$PID_FILE"

for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${MCP_INTERNAL_PORT}/health" >/dev/null 2>&1; then
    echo "MCP sidecar ready (pid $(cat "$PID_FILE"))"
    exit 0
  fi
  sleep 0.25
done

echo "MCP sidecar failed health check" >&2
kill "$(cat "$PID_FILE")" 2>/dev/null || true
rm -f "$PID_FILE"
exit 1
