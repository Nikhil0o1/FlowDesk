#!/usr/bin/env bash
# Enable repo git hooks (.githooks/). Run once after clone.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
git config core.hooksPath .githooks
for hook in .githooks/*; do
  [ -f "$hook" ] && chmod +x "$hook" 2>/dev/null || true
done
echo "Installed git hooks -> .githooks (flowdesk_ui)"
echo "  pre-commit  — block .env, run npm test on src/ or tests/ changes"
echo "  pre-push    — npm test + build, block push to main"
echo "  commit-msg  — reject empty messages and secret-like text"
