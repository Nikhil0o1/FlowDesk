# FlowDesk API

FastAPI backend for **FlowDesk** — work management platform with optional
**Celery + Redis** for production background jobs and horizontal scaling.

## Stack

Python 3.11 · FastAPI · SQLAlchemy 2 · PostgreSQL · APScheduler (dev) or Celery+Beat (prod) · Redis

## Quick start (dev — no Celery)

```bash
pip install -r requirements.txt
alembic upgrade head
python seed.py          # creates platform superadmin only (SUPERADMIN_EMAIL)
uvicorn app.main:app --reload --port 8000
```

Defaults: `CELERY_ENABLED=false`, `SCHEDULER_ENABLED=true`

## Production architecture

```text
Load balancer (Nginx / Gunicorn)
    ├── API instances (SCHEDULER_ENABLED=false)
    ├── Celery workers (task execution)
    ├── Celery Beat × 1 (scheduling only)
    └── Redis (broker + realtime pub/sub)
```

### Environment variables

| Variable | Production value |
|----------|------------------|
| `REDIS_URL` | `redis://host:6379/0` |
| `CELERY_ENABLED` | `true` |
| `SCHEDULER_ENABLED` | `false` on API |
| `CELERY_WORKER_CONCURRENCY` | `4` (per worker process) |
| `WEB_CONCURRENCY` | Gunicorn workers (e.g. `4`) |

### Local Celery test

```bash
docker compose up -d redis   # repo root

# flowdesk_API/.env
REDIS_URL=redis://localhost:6379/0
CELERY_ENABLED=true
SCHEDULER_ENABLED=false

uvicorn app.main:app --reload --port 8000
celery -A celery_app.app worker -Q default,scheduled,fast --pool=solo --loglevel=info
celery -A celery_app.app beat --loglevel=info
```

Windows worker: add `--pool=solo`

### Production commands

```bash
gunicorn app.main:app -c gunicorn_conf.py
bash scripts/celery_worker.sh
bash scripts/celery_beat.sh
```

## Module layout

```text
app/core/
  redis_client.py    # shared connection pool
  realtime_bus.py    # WebSocket pub/sub across API instances
  lifecycle.py       # startup/shutdown wiring
  health.py          # /health dependency checks
workers/             # job business logic (shared by APScheduler & Celery)
celery_app/
  factory.py         # Celery app factory
  config.py          # production broker/worker/beat settings
  signals.py         # worker ORM bootstrap
  tasks/             # scheduled + health tasks
```

## Health

`GET /health` returns structured status including Redis reachability and Celery mode.

Tests: `python -m pytest app/tests -q`

## Render deployment

The API must split **build** (install + migrate) from **start** (bind port). If migrations
or `seed.py` run in the start command, Render times out waiting for an open port and the
service keeps serving the previous build.

| Setting | Value |
|---------|--------|
| **Build Command** | `bash scripts/render_build.sh` |
| **Start Command** | `bash scripts/render_start.sh` |
| **Health Check Path** | `/health` |

`render_build.sh` runs `pip install`, `ensure_migrations.py`, and `alembic upgrade head`.
`seed.py` runs only when `SEED_ON_DEPLOY=true` (one-time fresh DB — remove the flag after).

**Wrong (causes deploy timeout):**

```bash
alembic upgrade heads && python seed.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

After updating settings, trigger **Manual Deploy → Deploy latest commit** on the API service.
