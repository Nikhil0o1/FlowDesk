# FlowDesk API

FastAPI backend for **FlowDesk** — an invitation-only B2B work management platform
(organizations → workspaces → spaces → projects → tasks, with sprints, chat,
whiteboards, forms, time tracking, Google Workspace and GitHub integrations).

The frontend (React/Vite) lives in its own repository and talks to this API over
`/api/v1/*` + a WebSocket at `/api/v1/ws`.

## Stack

Python 3.11 · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL · APScheduler · JWT auth
(rotating refresh tokens) · Google OAuth (SSO, Calendar, Gmail, Sheets) · GitHub webhooks.

## Local development

```bash
python -m venv .venv
.venv\Scripts\activate            # source .venv/bin/activate on unix
pip install -r requirements.txt

# configure ../.env from ../.env.example, then:
alembic upgrade head              # schema is migration-only
python seed.py                    # demo data + superadmin (idempotent)
uvicorn app.main:app --reload --port 8000
```

API docs (dev only): http://localhost:8000/api/docs · Health: `/health`

Tests: `python -m pytest app/tests -q` (provisions an isolated `flowdesk_test` database).

## Deploying on Render

- **Build command:** `pip install -r requirements.txt && alembic upgrade head`
- **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Set `PYTHON_VERSION=3.11.9` (or any 3.11.x).
- Run `python seed.py` once from the Render shell to create the superadmin.
- Single instance: keep `SCHEDULER_ENABLED=true`. Multiple instances: set it to
  `false` everywhere and run one `python -m app.workers.scheduler` background worker.

## Environment variables

Configuration is read from environment variables (the local dev `.env` lives at
the workspace root, shared with Vite; on Render set these in the dashboard). Key ones:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | `postgresql+psycopg2://user:pass@host:5432/dbname` |
| `SECRET_KEY` | long random string — signs JWTs |
| `ENVIRONMENT` | `production` (enables Secure/SameSite=None auth cookies) |
| `DEBUG` | `false` in production (disables /api/docs) |
| `FRONTEND_URL` | the Vercel URL — used for CORS and links in emails |
| `BACKEND_URL` | this service's public URL — used for OAuth redirect URIs |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google SSO + Calendar/Gmail/Sheets (add `<BACKEND_URL>/api/v1/calendar/google/callback` as an authorized redirect URI) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_USE_TLS` / `EMAIL_FROM` | outgoing email |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for `/api/v1/github/webhook` |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | bootstrap platform admin (created/synced by `seed.py`) |
| `STORAGE_BACKEND` | `local` (ephemeral on Render) or `s3` + `S3_*` vars for persistent uploads |

## Repository layout

```
app/
  api/v1/      # 19 routers: auth, orgs, workspaces, projects, tasks, sprints,
               # chat, teams, whiteboards, forms, calendar, integrations, github…
  core/        # config, security, websocket manager, rate limiting, smtp
  models/      # 42 SQLAlchemy tables
  schemas/     # Pydantic request/response models
  services/    # permissions, invites, google, github, sheets sync, emails…
  workers/     # APScheduler cron jobs (each run logged to cron_job_logs)
  tests/
migrations/    # Alembic (schema is migration-only)
seed.py        # idempotent demo data + superadmin bootstrap
```
