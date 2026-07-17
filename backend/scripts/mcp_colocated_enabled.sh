#!/usr/bin/env bash
# True when the colocated MCP sidecar should build/start on this service.
set -euo pipefail

if [ "${MCP_SIDECAR_ENABLED:-false}" = "true" ]; then
  exit 0
fi
if [ "${ENVIRONMENT:-}" = "production" ] && [ -z "${MCP_PUBLIC_URL:-}" ]; then
  exit 0
fi
exit 1
