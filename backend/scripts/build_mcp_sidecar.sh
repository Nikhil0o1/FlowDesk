#!/usr/bin/env bash
# Build the FlowDesk MCP sidecar (./mcp) during API deploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_DIR="${MCP_DIR:-$BACKEND_DIR/mcp}"

if ! bash "$SCRIPT_DIR/mcp_colocated_enabled.sh"; then
  echo "MCP sidecar disabled — skipping MCP build"
  exit 0
fi

if [ ! -f "$MCP_DIR/package.json" ]; then
  echo "MCP package not found at $MCP_DIR — skipping MCP build" >&2
  exit 1
fi

bash "$SCRIPT_DIR/ensure_node.sh"

echo "Building MCP sidecar in $MCP_DIR ..."
cd "$MCP_DIR"
npm ci
npm run build
test -f "$MCP_DIR/dist/http.js"
echo "MCP sidecar build OK"
