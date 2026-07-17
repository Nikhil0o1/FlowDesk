#!/usr/bin/env bash
# Local security gate — mirrors Brightcone "Deploy Frontend" security-scan job.
# Full step map: docs/SECURITY_CI.md
#   npm audit (critical) | verify:deps | verify:third-party | test:security
#   Snyk deps + SAST (optional) | Gitleaks 8.18.4 | TruffleHog --only-verified
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

reports_dir="${SECURITY_REPORTS_DIR:-$root/security-reports}"
mkdir -p "$reports_dir"

FAILED=false

echo "=== npm audit (critical — CI gate) ==="
if npm run audit:critical; then
  echo "OK: npm audit (critical)"
else
  echo "FAIL: npm audit (critical)"
  FAILED=true
fi

echo "=== npm audit (moderate — dependency hygiene) ==="
if npm run audit:ci; then
  echo "OK: npm audit (moderate)"
else
  echo "FAIL: npm audit (moderate)"
  FAILED=true
fi

echo "=== VAPT dependency pins (issue #7) ==="
if npm run verify:deps; then
  echo "OK: verify:deps"
else
  echo "FAIL: verify:deps"
  FAILED=true
fi

echo "=== Third-party surface (issue #4) ==="
if npm run verify:third-party; then
  echo "OK: verify:third-party"
else
  echo "FAIL: verify:third-party"
  FAILED=true
fi

echo "=== Vitest security suite ==="
if npm run test:security; then
  echo "OK: test:security"
else
  echo "FAIL: test:security"
  FAILED=true
fi

if [ -n "${SNYK_TOKEN:-}" ]; then
  echo "=== Snyk (dependencies) ==="
  if npx --yes snyk@1.1304.1 test --severity-threshold=critical --json > "$reports_dir/snyk-report.json"; then
    echo "OK: snyk test"
  else
    echo "FAIL: snyk test (see $reports_dir/snyk-report.json)"
    FAILED=true
  fi

  echo "=== Snyk Code (SAST) ==="
  if npx --yes snyk@1.1304.1 code test --severity-threshold=critical --json > "$reports_dir/snyk-code-report.json"; then
    echo "OK: snyk code test"
  else
    echo "FAIL: snyk code test (see $reports_dir/snyk-code-report.json)"
    FAILED=true
  fi
else
  echo "SKIP: Snyk (set SNYK_TOKEN to enable)"
fi

if command -v gitleaks >/dev/null 2>&1; then
  echo "=== Gitleaks ==="
  if gitleaks detect \
    --source=. \
    --redact \
    --log-opts="-1 HEAD" \
    --report-format json \
    --report-path "$reports_dir/gitleaks-report.json" \
    --exit-code 1; then
    echo "OK: gitleaks"
  else
    echo "FAIL: gitleaks (see $reports_dir/gitleaks-report.json)"
    FAILED=true
  fi
else
  echo "SKIP: gitleaks (install from https://github.com/gitleaks/gitleaks/releases)"
fi

if command -v trufflehog >/dev/null 2>&1; then
  echo "=== TruffleHog (verified secrets) ==="
  if trufflehog filesystem "$root" --only-verified --json > "$reports_dir/trufflehog-report.json"; then
    echo "OK: trufflehog"
  else
    echo "FAIL: trufflehog (see $reports_dir/trufflehog-report.json)"
    FAILED=true
  fi
else
  echo "SKIP: trufflehog (install from https://github.com/trufflesecurity/trufflehog/releases)"
fi

if [ "$FAILED" = true ]; then
  echo "Security scan failed."
  exit 1
fi

echo "All local security checks passed."
