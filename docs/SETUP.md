# Setup Guide

Everything needed to run FlowDesk locally on Windows (commands are PowerShell/cmd friendly; unix equivalents in comments).

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Python | 3.11+ | backend |
| Node.js | 20+ | frontend |
| PostgreSQL | 14+ | local install **or** the dockerized one in `docker-compose.yml` |
| Docker | any recent | only needed for Mailpit (local email inbox) and/or the optional Postgres |

## 1. Environment file (single root `.env`)

All configuration lives in **one file at the repository root**: `d:\FLowDesk\.env`.

- The **backend** loads it via `pydantic-settings` (`backend/app/core/config.py` resolves the repo root automatically — you can run uvicorn/alembic/pytest from any directory).
- The **frontend** (Vite) reads the same file for `VITE_*` variables (`envDir: '..'` in `frontend/vite.config.ts`).

```bash
copy .env.example .env        # cp .env.example .env
```

The current `.env` is configured for a **local PostgreSQL** install:

```
DATABASE_URL=postgresql+psycopg2://postgres:Nikhil-700@localhost:5432/flowdesk
```

To use the dockerized Postgres instead (it maps to port **5433** to avoid clashing with a local install):

```
DATABASE_URL=postgresql+psycopg2://flowdesk:flowdesk@localhost:5433/flowdesk
```

## 2. Infrastructure

```bash
# Mailpit (catches all outgoing email) — and optionally Postgres
docker compose up -d mailpit          # email only
docker compose up -d                  # email + dockerized postgres (:5433)
```

Mailpit web inbox: **http://localhost:8025** (SMTP on :1025).

If you use local Postgres, create the database once (psql or any client):

```sql
CREATE DATABASE flowdesk;
```

## 3. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate                # source .venv/bin/activate
pip install -r requirements.txt

# schema + demo data
alembic upgrade head
python seed.py

# run (http://localhost:8000, docs at /api/docs)
uvicorn app.main:app --reload --port 8000
```

## 4. Frontend

```bash
cd frontend
npm install
npm run dev                           # http://localhost:5173
```

The dev server proxies `/api/*` (including the WebSocket) to `:8000`, so auth cookies are same-origin and no CORS setup is needed in dev.

## 5. Log in

Open **http://localhost:5173**.

| Account | Email | Password | Role |
| --- | --- | --- | --- |
| Platform admin | `admin@flowdesk.dev` | `SuperAdmin123!` | Platform superadmin (admin panel only) |
| Olivia Owner | `owner@acme.dev` | `Password123!` | Organization owner |
| Adam Admin | `admin@acme.dev` | `Password123!` | Workspace admin |
| Maria Member | `maria@acme.dev` | `Password123!` | Project member |
| Dev Marshall | `dev@acme.dev` | `Password123!` | Project member |

## 6. Tests

```bash
cd backend
.venv\Scripts\python -m pytest app/tests -q
```

The suite creates an isolated `flowdesk_test` database on the same Postgres server and disables the scheduler, email sending and rate limiting automatically (see `app/tests/conftest.py`).

## 7. Optional integrations

### Google SSO
1. Create an OAuth 2.0 Web client in Google Cloud Console; add `http://localhost:5173` to authorized JavaScript origins.
2. Put the client id in **both** `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` in the root `.env`.
3. Restart both servers. Google login only works for **existing** (invited) accounts — there is no signup.

### GitHub webhooks
1. In your GitHub App / repo webhook settings, point the webhook to `https://<your-host>/api/v1/github/webhook` (use a tunnel like `ngrok http 8000` for local dev), content type `application/json`, events: `push`, `pull_request`, `issues`.
2. Set the same secret in `GITHUB_WEBHOOK_SECRET` (empty secret = signature check skipped, dev only).
3. In the app: register the installation (org owner) and connect a repository to a project via `POST /api/v1/github/repositories`.

### Scheduler in production
Run API replicas with `SCHEDULER_ENABLED=false` and exactly one dedicated worker:

```bash
python -m app.workers.scheduler
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `password authentication failed` on migrate | Check `DATABASE_URL` in the **root** `.env` — port 5432 = local install, 5433 = docker |
| Emails not arriving | Is Mailpit running? `docker compose up -d mailpit`, inbox at :8025 |
| 429 Too Many Requests on login | Rate limiter (10/min/IP) — wait a minute, or `RATE_LIMIT_ENABLED=false` (dev only) |
| WebSocket won't connect | It authenticates with the access token; make sure you're logged in and using the Vite proxy origin |
| Google button says not configured | Set both `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`, restart `npm run dev` |
