# FlowDesk Backend Test Suite

Professional, phase-based test architecture for the FlowDesk FastAPI backend. Tests live under `app/tests/` in **five existing folders** — no extra phase directories. External I/O (Google, GitHub, Redis, email) is mocked; the database is isolated per run.

---

## Executive summary

| Metric | Phase 1 (baseline) | Phase 8 | Current |
|--------|-------------------|---------|---------|
| **Production coverage** | ~43% | **79.1%** | **91.8%** |
| **Tests passing** | ~180 | **417** | **614** |
| **Coverage gate** (`.coveragerc`) | — | `fail_under = 78` | `fail_under = 95` (target) |

Coverage is measured with `pytest-cov` over the `app/` package (excluding `app/tests/`). The gate was raised incrementally so CI fails on regressions.

**Principle:** meaningful tests over line-padding — every phase targets real behaviour (auth, RBAC, webhooks, sheet sync, WebSocket handshake, GitHub repo connect, etc.) with mocks for third-party APIs.

---

## Journey: 43% → 91.8% (path to 95%)

### Phase 1 — Coverage audit
- Ran `pytest --cov=app --cov-report=term-missing` and catalogued misses by module.
- **Baseline:** ~43% coverage, legacy root tests only (`app/tests/test_*.py`).
- **Outcome:** phased plan (unit → integration → security → regression → gap-fill).

### Phase 2 — Unit tests (`unit/`)
- **~99 → 136 tests** covering services and core modules in isolation.
- Auth tokens, OTP lockout, RBAC, task rules, invites, 2FA, storage validation, rate-limit keys, JSON limits, GitHub webhook signature parsing, WebSocket ticket service, etc.
- **Later additions:** `test_google_external_api.py`, `test_github_external_api.py`, `test_websocket_manager.py`, expanded `test_storage_service.py`.

### Phase 3 — Integration tests (`integration/`)
- **~78 → 159 tests** (marker `-m integration`) exercising HTTP routes against `flowdesk_test` PostgreSQL.
- Full flows: auth OTP, orgs, workspaces, projects, tasks, sprints, forms, attachments, comments, invites, admin, Google integrations, calendar, GitHub OAuth, private chat, project activity.
- **Later additions:** GitHub connect-repo, task filters, WS realtime handshake (SessionLocal patch), users avatar, gap-fill files (`test_github_gaps.py`, `test_tasks_update_gaps.py`, etc.).

### Phase 4 — Security tests (`security/`)
- **26 tests:** OAuth hardening, JWT tampering, OTP lockout, refresh-token reuse, rate limits (429), request-body bombs, GitHub HMAC, security headers, cross-tenant IDOR.

### Phase 5 — Regression / smoke (`regression/`)
- **11 tests:** health, auth, org list, refresh, workspace/task/search/notification/profile release workflows.

### Phase 6 — Coverage gap-fill (`coverage/`)
- Started at ~72.6% overall; added service-level and API-adjacent tests without new folders.
- Dashboard aggregates, sheet sync, token vault, GitHub event processing, chat integration, Google service helpers, task custom fields, realtime bus, health edge cases.

### Phase 7 — External I/O mocks (same folders)
- Google/GitHub HTTP clients mocked in `unit/`; integration tests for Sheets, Gmail, Calendar, sheet sync toggle.
- Shared helper: `seed_google_connection()` in `helpers.py`.

### Phase 8 — OAuth, calendar, chat, GitHub events
- Calendar OAuth callback & events, GitHub OAuth authorize/callback, private chat channels, project invites/activity, GitHub PR/issue webhooks, Google timed events & `sheets_write`.
- **417 tests, 79.1% coverage**, gate at 78%.

### Phases 9–10 — Push toward 95%
- GitHub project connection, repo linking, create-issue/branch/PR (mocked GitHub API).
- Task filters, `my_tasks`, share GET, checklist/custom-field deletes, bulk task updates.
- WebSocket ping/pong & channel subscribe (`integration/test_ws_realtime.py` + SessionLocal proxy).
- Dashboard team workload / critical tasks / portfolio blocks.
- Storage S3 backend, calendar sync service, sprint rollover, auth refresh reuse, form schema validators.
- GitHub legacy installations, OAuth error paths, admin/calendar/chat/integrations gap tests.
- **614 tests, 91.8% coverage**; ~263 statements remain to hit the 95% gate.

---

## Directory layout

```
app/tests/
├── conftest.py          # DB isolation, client fixture, env overrides
├── helpers.py           # build_project_stack, add_task, seed_* helpers
├── unit/                # Phase 2 — pure unit / service tests
├── integration/         # Phase 3 — API + DB integration
├── security/            # Phase 4 — security & abuse
├── regression/          # Phase 5 — smoke / release checks
├── coverage/            # Phase 6+ — targeted gap-fill (unit + API hybrid)
├── test_*.py            # Legacy root suite (kept for compatibility)
└── README.md            # This document
```

| Directory | Marker | Tests (collect) | Purpose |
|-----------|--------|-----------------|---------|
| `unit/` | `unit` | **136** | Services & core logic, mocked I/O |
| `integration/` | `integration` | **159** | HTTP routes, real test DB |
| `security/` | `security` | **26** | Auth abuse, IDOR, limits, headers |
| `regression/` | `regression` | **11** | Release smoke workflows |
| `coverage/` | `coverage` | **148** | Gap-fill toward 95% (service + API) |
| Root `test_*.py` | *(mixed)* | **~134** | Legacy auth, RBAC, teams, uploads |
| **Total** | | **614** | |

Run by phase:

```powershell
cd flowdesk_API
python -m pytest app/tests/unit -m unit
python -m pytest app/tests/integration -m integration
python -m pytest app/tests/security -m security
python -m pytest app/tests/regression -m regression
python -m pytest app/tests/coverage -m coverage
python -m pytest app/tests                          # full suite
python -m pytest app/tests --cov=app --cov-report=term-missing
```

---

## Test pyramid check (60 / 30 / 10)

**Target distribution**

| Layer | Target | Role |
|-------|--------|------|
| Unit | **60%** | Fast, isolated — services, validators, mocks |
| Integration | **30%** | API + DB — route wiring, permissions |
| E2E / Security / Regression | **10%** | Smoke, abuse cases, release confidence |

**Actual distribution (614 tests)**

Classification uses pytest markers plus whether `coverage/` tests hit HTTP (`client` fixture) or only services/DB.

| Layer | Count | % | Target | Status |
|-------|------:|--:|-------:|--------|
| **Unit** | ~**262** | **42.7%** | 60% | Below target — add more pure unit tests in `unit/` for remaining service branches |
| **Integration** | ~**315** | **51.3%** | 30% | Above target — expected: most gap-fill and legacy tests are API-level |
| **Security + Regression + legacy security** | ~**37** | **6.0%** | *(part of 10% bucket)* | On track for security/regression markers |
| **Legacy root (mixed)** | ~**134** | **21.8%** | — | Predates phases; split between integration-style and unit-style |

**Pyramid verdict:** Security/regression volume (~6% + hardening tests in legacy ≈ **~10%**) matches the **10% E2E/Security/Regression** intent. The **60% unit / 30% integration** split is **not strictly met** by count because:

1. **`coverage/` is hybrid** — many tests call FastAPI routes to hit untested lines (counts as integration-style even with `@pytest.mark.coverage`).
2. **Legacy root tests** (`test_auth.py`, `test_tasks.py`, …) predate markers and skew toward integration.
3. **Design priority** was closing coverage gaps on API modules (`github.py`, `tasks.py`, `ws.py`) which naturally adds integration tests.

**Recommended rebalance (optional, post-95%):**
- Move pure service tests from `coverage/` into `unit/` and mark `unit`.
- Add `-m unit` to legacy unit-style root tests (`test_jwt_claims.py`, `test_github_validation.py`, …).
- Keep new gap-fill as unit tests when only service functions need covering.

---

## Shared infrastructure

### `conftest.py`
- Creates isolated PostgreSQL database `flowdesk_test` per session.
- Wraps each test in a transaction with nested savepoints (production `commit()` does not leak).
- Sets `RATE_LIMIT_ENABLED=false`, `REDIS_URL=""`, `EMAIL_ENABLED=false`, `CELERY_TASK_ALWAYS_EAGER=true`.
- Provides `client`, `db`, `org`, `owner` fixtures.

### `helpers.py` (created / extended)

| Helper | Purpose |
|--------|---------|
| `build_project_stack()` | Org → workspace → space → project with admin membership |
| `add_task()` | Seed task with project number |
| `add_project_member()` | User + org/workspace/project membership |
| `seed_google_connection()` | Google OAuth row with all integration scopes |
| `seed_personal_github()` | Personal GitHub connection for org + user |
| `seed_project_github()` | Project-scoped GitHub connection |
| `seed_github_repo()` | Active linked repository row |

### Auth in tests
- `auth_headers(client, email)` mints JWT directly (bypasses OTP email flow).

### WebSocket testing
- `app/api/v1/ws.py` uses `SessionLocal()` outside FastAPI `get_db`.
- Pattern: `_WsDbProxy` + `monkeypatch.setattr("app.db.session.SessionLocal", …)` so ticket redeem + DB lookups use the test session (`integration/test_ws_realtime.py`).

### External I/O
- Patch at **call site** (e.g. `app.api.v1.github.github_api_service.create_issue`) or service module (`app.services.google_service.http.post`).
- Never call real Google/GitHub/S3 in tests.

---

## Files created (Phases 6–10)

### `unit/` — new / expanded

| File | Purpose |
|------|---------|
| `test_google_external_api.py` | Mocked Google Sheets, Gmail, Calendar HTTP |
| `test_github_external_api.py` | Mocked GitHub REST client (repos, issues, branches, PRs, webhooks) |
| `test_websocket_manager.py` | ConnectionManager connect/broadcast/emit |
| `test_storage_service.py` | *(expanded)* MIME sniff, S3 backend, validation edge cases |

### `integration/` — new

| File | Purpose |
|------|---------|
| `test_github_connect.py` | Project connection lifecycle, connect-repo, issue/branch/PR, connected search |
| `test_github_oauth.py` | GitHub OAuth authorize + callback |
| `test_tasks_filters.py` | `my_tasks`, list filters, share invite, GitHub issue sync on status |
| `test_ws_realtime.py` | WS ping/pong, channel subscribe, whiteboard subscribe |
| `test_users_extended.py` | Avatar upload, profile status, activity feed |
| `test_chat_private.py` | Private channels, add/leave members |
| `test_projects_extended.py` | Project invites, activity feed |
| `test_calendar.py` | *(extended)* Google callback, upcoming events |
| `test_task_advanced.py` | *(extended)* checklist/item delete |
| `test_github_gaps.py` | OAuth errors, webhook paths, connect-repo guards, 502 paths |
| `test_tasks_update_gaps.py` | clear_* fields, list_id filters, attachments on detail |
| `test_projects_members_gaps.py` | Member add by email, space/archive edge cases |

### `coverage/` — new (Phase 6–10 gap-fill)

| File | Purpose |
|------|---------|
| `test_dashboard_service.py` | Org dashboard KPIs, team workload, critical tasks, portfolio |
| `test_calendar_sync_service.py` | push/refresh/remove Google Calendar events |
| `test_sheet_sync_service.py` / `test_sheet_sync_extended.py` | Export, two-way sync, `_create_task_from_row` |
| `test_google_service.py` / `test_google_service_extended.py` | Token refresh, calendar update/delete, focusTime/OOO |
| `test_github_service_events.py` | PR/issue webhook → task creation |
| `test_github_legacy.py` | Legacy installations, webhook ping, invalid token |
| `test_task_extensions.py` | Custom fields, labels, delete field |
| `test_tasks_extended.py` | Subtasks, assignee remove, sprint/status filters |
| `test_tasks_bulk.py` | Archive, reorder, duplicate, time entries |
| `test_projects_crud.py` | Space/project/list/status delete paths |
| `test_teams_extended.py` | Team CRUD, members, project team assign |
| `test_ws_*` / `test_realtime_bus_*` | Realtime bus publish/listener, Redis mocks |
| `test_auth_service_extended.py` | OTP, refresh reuse, Google/MS SSO edges |
| `test_invite_service_extended.py` | Org activate, accept, expired invite |
| `test_admin_extended.py` | Org search, audit logs, cron logs |
| `test_chat_api_extended.py` | Channel update, threads, read receipts |
| `test_calendar_api_extended.py` | Disconnect, auth-url when connected |
| `test_integrations_extended.py` | Sheet sync toggle, Gmail status |
| `test_core_lifecycle.py` / `test_emailer.py` | Startup validation, email backends |
| `test_form_validators.py` | Form schema `_validate_fields` + API CRUD |
| `test_services_infra_gaps.py` | Redis, lifecycle, auth, invite, sheet cells, GitHub tags |
| `test_high_impact_boost.py` / `test_final_coverage_boost.py` | Sprint rollover, calendar API, chat messages, integrations toggle |
| `test_sprints_extended.py` | Burndown, velocity, board, complete rollover |

### Production files edited (testability / correctness)

| File | Change | Why |
|------|--------|-----|
| `app/services/upload_service.py` | `settings.upload_multipart_overhead_bytes` | Avatar upload used wrong settings attribute (bug fix found by tests) |
| `.coveragerc` | `fail_under = 95`, omit `app/workers/scheduler.py` | CI gate; scheduler is a thin re-export entrypoint |

---

## Prerequisites

- PostgreSQL with credentials in `flowdesk_API/.env` (`DATABASE_URL`).
- Tests auto-create database **`flowdesk_test`** (see `conftest.py`).
- Python dependencies from `requirements.txt` (includes `pytest`, `pytest-cov`, `httpx`).

---

## Configuration reference

| File | Role |
|------|------|
| `pytest.ini` | Markers: `unit`, `integration`, `security`, `regression`, `coverage` |
| `.coveragerc` | Source `app/`, omit tests & `__init__.py`, **`fail_under = 95`** |
| `conftest.py` | Fixtures, env overrides, DB lifecycle |

---

## Remaining work to 95%

At **91.8%**, largest remaining misses:

| Module | ~Miss | Next tests |
|--------|------:|------------|
| `api/v1/tasks.py` | 50 | Share remove, bulk edge cases |
| `api/v1/sprints.py` | 37 | Invalid rollover, burndown with dates |
| `api/v1/github.py` | 36 | Remaining OAuth/installation branches |
| `services/google_service.py` | 28 | Error branches, attendees |
| `services/github_service.py` | 31 | Additional webhook actions |
| `services/auth_service.py` | 27 | Microsoft token paths |
| `api/v1/calendar.py` | 26 | Create/delete event routes |

Run gap analysis anytime:

```powershell
python -m pytest app/tests --cov=app --cov-report=term-missing
```

---

## Conventions for new tests

1. **Place tests in the existing folder** that matches the layer (`unit/`, `integration/`, `security/`, `regression/`, or `coverage/` for gap-fill).
2. **Do not add** `phase7/`, `phase8/`, etc. folders.
3. **Mock external I/O** — never hit real Google, GitHub, Redis, or SMTP.
4. **Use helpers** — `build_project_stack`, `seed_*`, `auth_headers` for consistent data.
5. **Mark tests** with the appropriate `@pytest.mark.*` for selective CI runs.
6. **Prefer behaviour assertions** over chasing lines — raise `fail_under` only when coverage is earned.

---

*Last verified: 614 tests passing, **91.8%** production coverage, gate **95%** in `.coveragerc`.*
