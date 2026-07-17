#!/usr/bin/env bash
# Install Node.js 20 when missing (Render build image).
set -euo pipefail

if command -v node >/dev/null 2>&1; then
  echo "Node.js already installed: $(node --version)"
  exit 0
fi

echo "Installing Node.js 20 for MCP sidecar build..."

if command -v apt-get >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache nodejs npm
else
  echo "No supported package manager found — install Node.js 20 manually" >&2
  exit 1
fi

echo "Node.js installed: $(node --version)"
echo "npm version: $(npm --version)"
