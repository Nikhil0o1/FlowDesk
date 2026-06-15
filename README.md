<div align="center">

# FlowDesk

**An invitation-only B2B work management platform — projects, sprints, chat, whiteboards, forms and time tracking in one pitch-black, ClickUp-inspired workspace.**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Tests](https://img.shields.io/badge/tests-18%20passing-4CB782)]()

</div>

---

FlowDesk is a production-grade SaaS starter with **no public signup** — users enter only through invitation and onboarding emails. It implements the full hierarchy `organization → workspace → space → project → list → task → subtask` with scoped role-based access control, realtime collaboration over WebSockets, and a platform admin panel that is hard-isolated from organization data.

## Feature highlights

| Area | What's inside |
| --- | --- |
| **Tasks** | List / Board / Calendar / Gantt / Table views, custom statuses, priorities, multi-assignees, subtasks, dependencies, labels, story points, attachments, recurring tasks, per-project refs (`PHX-12`) |
| **Collaboration** | Threaded comments with `@mentions` (records + notifications + emails), workspace chat channels with typing indicators & read receipts, presence dots |
| **Realtime** | Room-scoped WebSockets — task/comment/chat/timer/sprint/GitHub events stream only to users entitled to them |
| **Agile** | Sprints with scrum-master scoping, backlog management, burndown charts, daily standups |
| **Teams** | Named member groups per workspace with full member management |
| **Whiteboards** | Canvas editor — sticky notes, text, shapes, drag/resize, debounced autosave to JSONB |
| **Forms** | Template-driven builder (Project Intake / Feedback / Order), live preview, public share links *and* in-app member filling — every submission becomes a real task |
| **Planner** | Google Calendar OAuth integration (token refresh, 7-day event feed) beside tasks due this week; Outlook config-gated |
| **Time tracking** | One running timer per user, manual entries, weekly timesheet grid with day/row totals, auto-stop for abandoned timers |
| **GitHub** | HMAC-verified webhooks (push / PR / issues), `KEY-123` commit linking, project activity feed, PR notifications |
| **Notifications & email** | 14 in-app notification types delivered realtime + 12 professional SMTP templates behind a swappable backend |
| **Profiles** | Status text, avatar color picker, real avatar upload (storage-backed), personal activity feed |
| **Admin** | Platform superadmin panel: org metadata & aggregate usage only (content access returns 404 — enforced and tested), audit + cron logs |
| **Background jobs** | 8 APScheduler crons (reminders, digests, recurring tasks, invite cleanup…) each logged to the database |

## Tech stack

- **Frontend** — React 18 · Vite · TypeScript · Tailwind CSS · React Router · TanStack Query · Zustand · native WebSocket client
- **Backend** — Python 3.11 · FastAPI · SQLAlchemy 2 · Alembic · Pydantic v2 · APScheduler
- **Data** — PostgreSQL (41 tables, UUID PKs, JSONB, soft deletes, migration-based schema)
- **Auth** — JWT access tokens + rotating refresh tokens (httpOnly cookie, family-based reuse detection), Google SSO, SHA-256-hashed single-use invite/reset tokens
- **Infra** — single root `.env`, Docker Compose for Mailpit (+ optional Postgres), local/S3 storage abstraction

## Quick start

> Full guide with troubleshooting: **[docs/SETUP.md](docs/SETUP.md)**

Prereqs: Python 3.11+, Node 20+, PostgreSQL, Docker (for the Mailpit dev inbox).

```bash
# 0. Configuration — single .env at the repo root
cp .env.example .env          # set DATABASE_URL to your Postgres

# 1. Mailpit (catches all outgoing email → http://localhost:8025)
docker compose up -d mailpit

# 2. Backend  →  http://localhost:8000  (docs at /api/docs)
cd backend
python -m venv .venv && source .venv/Scripts/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt
alembic upgrade head
python seed.py
uvicorn app.main:app --reload --port 8000

# 3. Frontend  →  http://localhost:5173  (proxies /api to :8000)
cd ../frontend
npm install
npm run dev
```

### Demo accounts (seeded)

| Account | Email | Password | Role |
| --- | --- | --- | --- |
| Platform admin | `admin@flowdesk.dev` | `SuperAdmin123!` | Superadmin (admin panel only) |
| Olivia Owner | `owner@acme.dev` | `Password123!` | Organization owner |
| Adam Admin | `admin@acme.dev` | `Password123!` | Workspace admin |
| Maria Member | `maria@acme.dev` | `Password123!` | Project member |

## Role model

Roles are **memberships, never global flags** (the single exception is `is_platform_superadmin`, which is platform-scope only):

| Capability | Superadmin | Org owner | WS admin | Project member |
| --- | :-: | :-: | :-: | :-: |
| Org metadata / disable orgs / platform audit | ✅ | — | — | — |
| Org tasks, chat, files, whiteboards, forms | ❌ isolated | ✅ | ✅ own WS | ✅ own projects |
| Create / delete workspaces | — | ✅ | ❌ | ❌ |
| Spaces, projects, sprints, channels, teams | — | ✅ | ✅ own WS | ❌ |
| Invite users | — | ✅ | ✅ WS/projects | ❌ |
| Tasks, comments, chat, time tracking | — | ✅ | ✅ | ✅ |

**Scrum master** is a per-sprint role, not a rank: workspace admins (or the current scrum master) can assign any workspace member as scrum master of a sprint, which lets that person edit/start/complete *that sprint only* — no other admin rights.

Every protected endpoint passes through a central `PermissionService`; resources you can't see return **404**, not 403.

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Step-by-step local setup, integration config (Google OAuth, GitHub webhooks), troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, auth flows, scoped RBAC, realtime rooms, email system, security checklist |
| [docs/API.md](docs/API.md) | Full REST + WebSocket reference with per-endpoint permissions |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema reference for every table, with ER sketch |
| [docs/FEATURES.md](docs/FEATURES.md) | Feature-by-feature build status, including known placeholders |

## Repository layout

```
.env.example            # single root environment file (backend + frontend)
docker-compose.yml      # Mailpit + optional Postgres
docs/                   # setup · architecture · api · database · features
backend/
  app/
    api/v1/             # 18 routers: auth, orgs, workspaces, projects, tasks,
                        # comments, chat, sprints, teams, whiteboards, forms,
                        # calendar, time, notifications, search, github, admin, ws
    core/               # config, security, websocket manager, rate limit, smtp
    models/             # 41 tables across 18 modules
    schemas/            # Pydantic request/response models
    services/           # permissions, invites, tasks, mentions, emails, storage…
    workers/            # APScheduler cron jobs (logged to cron_job_logs)
    tests/              # auth, invites, scoped RBAC, task CRUD
  migrations/           # Alembic
  seed.py
frontend/
  src/
    components/         # task views, comments, chat, profile drawer, ui kit, brand icons
    layouts/            # icon rail (hover flyout sidebars), section sidebars, topbar
    lib/                # api client (auto-refresh), ws client, queries, types
    pages/              # auth · app (overview, planner, teams, whiteboards, forms,
                        # timesheet, app center, sprints, chat, …) · admin · public forms
    stores/             # zustand: auth, ui, workspace, toasts
```

## Tests

```bash
cd backend
python -m pytest app/tests -q     # 18 passed
```

The suite provisions an isolated `flowdesk_test` database and covers login, refresh-token rotation + reuse detection, the full invite → activate flow, superadmin isolation, scoped visibility, and task CRUD permissions.

## Optional integrations

| Integration | How to enable |
| --- | --- |
| **Google SSO + Calendar + Gmail + Sheets** | Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VITE_GOOGLE_CLIENT_ID` in `.env`; add `http://localhost:8000/api/v1/calendar/google/callback` as an authorized redirect URI and `http://localhost:5173` as an authorized origin; enable the Calendar, Gmail and Sheets APIs. One in-app connect (App Center → Google Workspace) covers calendar feed, invite emails via the inviter's Gmail, task-related email lookup, and Sheets export, one-way/two-way live sync (sheet edits and new rows flow back into FlowDesk) and time tracking reports |
| **GitHub** | Point a webhook at `/api/v1/github/webhook` (push, pull_request, issues) and set `GITHUB_WEBHOOK_SECRET`; connect repos from the App Center |
| **S3 storage** | `STORAGE_BACKEND=s3` + `S3_*` vars (`pip install boto3`) |

## Production notes

- Set `ENVIRONMENT=production` (secure cookies), a strong `SECRET_KEY`, real SMTP credentials.
- Run `alembic upgrade head` on deploy — the schema is migration-only.
- Scale the API horizontally with `SCHEDULER_ENABLED=false` and one dedicated `python -m app.workers.scheduler` worker.
- Serve the built frontend (`npm run build` → `frontend/dist/`) from the same origin as the API, or set `FRONTEND_URL` for CORS.

## License

Private project — all rights reserved.
