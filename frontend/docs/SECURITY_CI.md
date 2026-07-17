# Security CI — Brightcone `Deploy Frontend` → FlowDesk map

Every step from the Brightcone **`Deploy Frontend`** workflow is listed below with **where it lives in FlowDesk** and **what it is for**.

FlowDesk file: `.github/workflows/ci.yml` (workflow name: **CI**, not Deploy Frontend).  
Brightcone deploy (S3/CloudFront/AWS) is **documented but not copied** — wrong account and env vars.

**Triggers:** Brightcone `main` / `staging` + `workflow_dispatch`. FlowDesk `main` / `development` + PRs + `workflow_dispatch`.

---

## Complete step inventory

| # | Brightcone `Deploy Frontend` | FlowDesk equivalent | Where written | Test file | Use |
|---|------------------------------|---------------------|---------------|-----------|-----|
| **Workflow** |
| 1 | `name: Deploy Frontend` | `name: CI` | `.github/workflows/ci.yml` L1 | `ciWorkflow.security.test.ts` | Identifies the workflow |
| 2 | `on: push main/staging` | `on: push main/development` + PRs | `ci.yml` L3–8 | `ciWorkflow.security.test.ts` | When CI runs |
| 3 | `workflow_dispatch` | Same | `ci.yml` L8 | `ciWorkflow.security.test.ts` | Manual re-run from Actions tab |
| 4 | `concurrency` deploy group | `ui-ci-${{ github.ref }}` | `ci.yml` L10–12 | `ciWorkflow.security.test.ts` | Cancel duplicate runs |
| 5 | `permissions: id-token: write` | — (not needed) | — | `ciWorkflow.security.test.ts` | AWS OIDC for deploy only |
| 6 | `env: AWS_REGION, S3_BUCKET, CloudFront` | — (not copied) | Documented here | `ciWorkflow.security.test.ts` | Brightcone S3/CloudFront targets |
| **Job: `check-scope`** |
| 7 | Checkout `fetch-depth: 0` | Same | `ci.yml` L21–25 | `ciWorkflow.security.test.ts` | Full history for downstream scanners |
| 8 | `should_deploy` output | Same (`should_deploy=true` always) | `ci.yml` L27–30 | `ciWorkflow.security.test.ts` | Gate all jobs (deploy scope in Brightcone) |
| **Job: `security-scan`** |
| 9 | Job name | Same exact name | `ci.yml` L33 | `ciWorkflow.security.test.ts` | Visible in Actions UI |
| 10 | `needs: [check-scope]` + `if: should_deploy` | Same | `ci.yml` L36–37 | `ciWorkflow.security.test.ts` | Only run when scope allows |
| 11 | Checkout `fetch-depth: 0` | Same | `ci.yml` L39–42 | `ciWorkflow.security.test.ts` | Git history for Gitleaks/TruffleHog |
| 12 | Node.js + `npm ci` | Node **24** (Brightcone uses 20) | `ci.yml` L44–52 | — | Install dependencies |
| 13 | npm audit critical | `npm run audit:critical` | `ci.yml` L54–57, `package.json` | `dependencies.security.test.ts` | Block critical CVEs in packages |
| 14 | — | VAPT dependency pins (#7) | `ci.yml` L59–60 | `dependencies.security.test.ts` | Enforce safe vite / react-router |
| 15 | — | Third-party hardening (#4) | `ci.yml` L62–63 | `thirdParty.security.test.ts` | No CDN scripts in HTML |
| 16 | — | Vitest security suite | `ci.yml` L65–66 | All `tests/security/*` | Automated security rules |
| 17 | Check `SNYK_TOKEN` | Same | `ci.yml` L68–79 | `ciWorkflow.security.test.ts` | Skip Snyk if no token |
| 18 | Install Snyk `1.1304.1` | Same | `ci.yml` L81–83 | `ciWorkflow.security.test.ts` | Pinned Snyk CLI |
| 19 | Snyk deps `--severity-threshold=critical` | Same | `ci.yml` L85–91 | `ciWorkflow.security.test.ts` | Extra vuln database |
| 20 | Snyk Code SAST | Same | `ci.yml` L93–99 | `ciWorkflow.security.test.ts` | Static analysis on source |
| 21 | Snyk diagnostics | Same | `ci.yml` L101–108 | `ciWorkflow.security.test.ts` | Log JSON on failure |
| 22 | TruffleHog `v3.82.6` `--only-verified` | Same | `ci.yml` L110–118 | `ciWorkflow.security.test.ts` | Verified secrets in git |
| 23 | Gitleaks `8.18.4` | Same | `ci.yml` L120–143 | `ciWorkflow.security.test.ts` + `secrets.security.test.ts` | Secret patterns in commits |
| 24 | Upload `frontend-security-reports` | Same | `ci.yml` L145–153 | `ciWorkflow.security.test.ts` | Downloadable JSON reports |
| 25 | Fail gate | Same | `ci.yml` L155–183 | `ciWorkflow.security.test.ts` | Single pass/fail |
| **Job: `run-tests`** (parallel with security-scan) |
| 26 | `needs: [check-scope]` | Same (not security-scan) | `ci.yml` L188–189 | `ciWorkflow.security.test.ts` | Parallel with security-scan |
| 27 | Checkout | Same | `ci.yml` L191–192 | — | Clone repo |
| 28 | Node + `npm ci` | Same | `ci.yml` L194–202 | — | Install |
| 29 | `npm run lint` | Same | `ci.yml` L204–205 | — | TypeScript check |
| 30 | Jest `--ci --coverage --runInBand` | **Vitest** `npm run test:ci` | `ci.yml` L207–208, `package.json` | — | Full test suite + coverage |
| 31 | — | `sync:coverage-summary` | `ci.yml` L210–211 | — | Update `tests/coverage-summary.json` |
| 32 | Upload `frontend-coverage-report` | Same + `tests/` files | `ci.yml` L213–221 | `ciWorkflow.security.test.ts` | Coverage artifact |
| **Job: `deploy-staging` (Brightcone) → `build` (FlowDesk)** |
| 33 | `needs: [check-scope, security-scan, run-tests]` | Same on `build` | `ci.yml` L226–227 | `ciWorkflow.security.test.ts` | Wait for security + tests |
| 34 | Build with 12× Brightcone `VITE_*` | **2× FlowDesk OAuth** secrets | `ci.yml` L240–252 | `ciWorkflow.security.test.ts` | Production compile |
| 35 | Validate `dist/index.html` | Same | `ci.yml` L247–251 | `ciWorkflow.security.test.ts` | Confirm build output |
| 36 | AWS OIDC `configure-aws-credentials` | **Not in FlowDesk** | — | `ciWorkflow.security.test.ts` | Brightcone deploy auth |
| 37 | S3 sync (long cache assets) | **Not in FlowDesk** | — | `ciWorkflow.security.test.ts` | Brightcone static hosting |
| 38 | S3 cp `index.html` (no cache) | **Not in FlowDesk** | — | `ciWorkflow.security.test.ts` | Fresh HTML on deploy |
| 39 | CloudFront invalidation | **Not in FlowDesk** | — | `ciWorkflow.security.test.ts` | CDN cache bust |
| 40 | Deployment summary | **Not in FlowDesk** (use `ci-success`) | `ci.yml` L254–259 | — | Actions summary |
| **Extra FlowDesk job** |
| 41 | — | `ci-success` gate | `ci.yml` L254–259 | — | Final all-jobs-passed marker |

---

## Where each security test file fits

| Test file | Tests | Brightcone step(s) it covers |
|-----------|-------|------------------------------|
| `ciWorkflow.security.test.ts` | 24 | Entire workflow YAML structure |
| `secrets.security.test.ts` | 2 | Gitleaks + TruffleHog complement |
| `dependencies.security.test.ts` | 2 | npm audit + Snyk complement |
| `thirdParty.security.test.ts` | 4 | FlowDesk VAPT #4 (extra) |
| `clarity.test.ts` | 4 | FlowDesk VAPT #4 (extra) |
| `securityHeaders.test.ts` | 5 | FlowDesk VAPT #1 (extra) |
| `deployHeaders.security.test.ts` | 6 | FlowDesk VAPT #1 / #4 / #8 — Render + Cloudflare header parity |

---

## Local commands (mirror CI)

| Brightcone CI step | Local command | Where |
|--------------------|---------------|-------|
| security-scan (fast) | `npm run security:local` | `package.json` |
| security-scan (full) | `npm run security:scan` | `scripts/security-scan.sh` |
| run-tests | `npm run lint && npm run test:ci` | `package.json` |
| build | `npm run build` | `package.json` |
| Human report | `tests/TEST_REPORT.md` | Updated after `test:ci` |

```bash
npm run security:local    # audit + 41 vitest security tests (PowerShell OK)
npm run security:scan     # full gate via Git Bash (+ Snyk/Gitleaks/TruffleHog if installed)
npm run test:security     # all tests/security/*.test.ts
npm run test:ci           # full suite (422+ tests) with coverage
```

---

## GitHub secrets

### FlowDesk (used)

| Secret | Job | Purpose |
|--------|-----|---------|
| `SNYK_TOKEN` | security-scan | Optional Snyk deps + SAST |
| `VITE_GOOGLE_CLIENT_ID` | build | Google OAuth build |
| `VITE_MICROSOFT_CLIENT_ID` | build | Microsoft SSO build |

### Brightcone deploy secrets (NOT used in FlowDesk)

`VITE_BACKEND_URL`, `VITE_RECRUITMENT_API_URL`, `VITE_REASONING_API_URL`, `VITE_TRANSIT_API_BASE_URL`, `VITE_TARTA_API_BASE_URL`, `VITE_RABBIT_API_BASE_URL`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_CLARITY_*`, `VITE_BRIGHT_PROPERTY_URL`, `VITE_HELPDESK_API_URL`, `VITE_BRIGHT_AGENT_ROUTER_URL` — see Brightcone `deploy-staging` only.

See `.github/SECRETS.md` for FlowDesk setup.
