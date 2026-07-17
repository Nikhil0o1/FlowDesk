# Architecture

## System overview

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  React SPA (Vite, :5173)    │  /api/* │  FastAPI (:8000)                 │
│  - React Router             │ ──────► │  - REST routers (/api/v1/…)      │
│  - TanStack Query (server   │  proxy  │  - WebSocket endpoint (/api/v1/ws)│
│    state) + Zustand (UI)    │ ◄────── │  - PermissionService on every     │
│  - native WebSocket client  │   WS    │    protected endpoint            │
└─────────────────────────────┘         │  - APScheduler cron (in-process) │
                                        └───────────┬──────────────────────┘
                                                    │ SQLAlchemy 2 (sync)
                                        ┌───────────▼──────────┐   ┌─────────┐
                                        │ PostgreSQL           │   │ SMTP    │
                                        │ 36 tables, UUID PKs, │   │ Mailpit │
                                        │ Alembic migrations   │   │ (dev)   │
                                        └──────────────────────┘   └─────────┘
```

- **Single root `.env`** configures everything; backend resolves it by path, Vite reads `VITE_*` from it via `envDir`.
- In dev, Vite proxies `/api` (HTTP + WS) to the backend so the refresh cookie is same-origin — no CORS in the auth path.

## Backend layering

```
api/v1/*.py      HTTP layer: routing, query params, status codes.
                 Depends(get_db), Depends(get_current_user / get_permissions).
schemas/*.py     Pydantic v2 request/response models. ORM objects are never
                 returned raw; list endpoints return Page[T] {items,total,page,page_size}.
services/*.py    Business logic: permissions, auth, invites, tasks, mentions,
                 notifications, email templates, activity, audit, github, storage.
models/*.py      SQLAlchemy 2 mapped classes (UUIDPkMixin, TimestampMixin,
                 SoftDeleteMixin). db/base.py imports all for Alembic discovery.
workers/*.py     APScheduler jobs; every run wrapped by run_logged() → cron_job_logs.
core/*.py        config (root .env), security (bcrypt, JWT, token hashing),
                 websocket ConnectionManager, rate limiter, SMTP backend.
```

### Request lifecycle (typical protected endpoint)

1. `HTTPBearer` extracts the JWT → `get_current_user` validates signature/expiry, loads an active `User`.
2. `get_permissions` wraps the user in a `PermissionService`.
3. The endpoint calls a `require_*` method (e.g. `require_project_edit`) — failure raises 403, or **404 for resources the user shouldn't know exist**.
4. Service-layer mutation: writes rows, plus side effects in the same transaction —
   `notify()` (in-app notification + `notification.created` WS event), `log_activity()`,
   `audit()`, and email via the fire-and-forget SMTP thread.
5. Realtime event emitted via `emit(event, rooms, payload, **scope_ids)`.
6. Single `db.commit()`; the response is rebuilt through Pydantic schemas.

## Authentication design

| Credential | Storage | Lifetime | Notes |
| --- | --- | --- | --- |
| Access token | JWT, in-memory on the client (Zustand) | 30 min | claims: `sub`, `sa` (superadmin), `jti` |
| Refresh token | httpOnly cookie `flowdesk_refresh` (path-limited to `/api/v1/auth`); **SHA-256 hash** in `refresh_tokens` | 14 days | rotated on every refresh; `family_id` links a session |
| Invite token | raw in email link only; SHA-256 hash in `invites` | 48 h | single-use |
| Password reset token | hash in `password_reset_tokens` | 60 min | single-use; resets revoke all refresh tokens |

**Rotation + reuse detection:** every `/auth/refresh` revokes the presented token and issues a new one in the same family. If a *revoked* token is ever presented again (theft/replay), the entire family is revoked and the session dies. Verified by tests.

**No public signup.** Accounts are only created by `activate-invite` (new users set their own password) — Google SSO also refuses unknown emails. Existing users invited to new scopes go through `accept-invite` with no password change.

## Authorization (scoped RBAC)

Roles live in **membership tables**, never on the user (the only global flag is `is_platform_superadmin`):

```
organization_members.role  : owner | member
workspace_members.role     : admin | member
project_members.role       : admin | member | viewer
```

Resolution rules implemented in `PermissionService`:

- **Org owner** implicitly has admin rights over every workspace/project in the org.
- **Workspace admin** has admin rights over projects inside that workspace only.
- **Project members** see only projects they belong to; `viewer` can read but not write.
- Workspace **delete/archive** requires the *org owner* (workspace admins cannot).
- **Scrum master** is a *per-sprint facilitation role*, not a permission tier: any member of the
  sprint's workspace is eligible (enforced — assigning a non-member returns 422). It is assigned by
  whoever can edit the sprint (workspace admin, org owner, or the current scrum master when handing
  off). The scrum master can edit, start and complete *that sprint only*; they gain no other admin
  rights. Sprint create/delete remain workspace-admin/org-owner only.
- **Superadmin is platform-scope only**: admin endpoints return org *metadata and aggregate counts*; all org-content endpoints treat a superadmin without membership as a stranger (404). This is enforced and tested.

## Realtime design

`core/websocket.py` implements a room-based `ConnectionManager`:

- On connect (`POST /api/v1/ws/ticket` then `/api/v1/ws?ticket=…`), the user's accessible rooms are computed from memberships: `user:{id}`, `workspace:{id}`, `project:{id}`, `channel:{id}`. **You only ever receive events for rooms you were entitled to at connect time** (chat channels created later can be joined via a verified `subscribe.channel` or `subscribe` message). External SaaS use `/api/v1/integrations/ws` with a PAT that has `realtime:read`.
- Event envelope: `{"type": "task.updated", "workspace_id": …, "project_id": …, "task_id": …, "payload": {…}}`.
- Sync REST handlers emit through `emit()` → `run_coroutine_threadsafe` onto the server loop.
- Presence: first socket per user broadcasts `presence.online` to their workspaces; last close broadcasts `presence.offline`; new sockets receive a `presence.state` snapshot.
- Client (`frontend/src/lib/ws.ts`): auto-reconnect with backoff, 30s ping, event bus with a `useRealtime(types, handler)` hook; components invalidate TanStack Query caches on relevant events.

Events: `task.created/updated/deleted/assigned`, `comment.created/updated/deleted`, `mention.created`, `notification.created`, `chat.message.created`, `chat.typing`, `chat.read`, `presence.*`, `timer.started/stopped`, `sprint.updated`, `github.event.created`.

## Email system

`services/email_service.py` holds all 12 templates (shared B2B HTML layout); `core/emailer.py` is the transport abstraction (`EmailBackend` → `SMTPBackend` | `ConsoleBackend`) — swap providers by implementing one class. Sending happens on a daemon thread so requests never block on SMTP.

Invite logic: *user doesn't exist* → onboarding email with activation link; *user exists* → accept-invitation email + in-app notification. Task assignment and mentions never create users.

## Background jobs

APScheduler (`workers/scheduler.py`) starts with the API in dev (`SCHEDULER_ENABLED`), or standalone via `python -m app.workers.scheduler`. Every execution writes a `cron_job_logs` row (status, items processed, error message), visible in the admin panel.

| Job | Schedule |
| --- | --- |
| due_date_reminders | daily 08:00 UTC |
| overdue_task_notifications | daily 08:15 |
| stop_abandoned_timers | every 30 min |
| daily_digest | daily 07:30 |
| github_sync_fallback | hourly (placeholder — needs GitHub App key) |
| recurring_task_generation | every 15 min |
| sprint_completion_reminder | daily 09:00 |
| cleanup_expired_invites | daily 02:00 |

## Frontend structure

```
src/
  lib/        api.ts (fetch wrapper: bearer header, single-flight cookie refresh on 401,
              FormData uploads, blob downloads) · ws.ts (realtime client + presence store)
              queries.ts (shared TanStack Query hooks incl. org/workspace context resolution)
              types.ts (mirrors backend schemas) · utils.ts
  stores/     zustand: auth (token+user), workspace (persisted org/workspace selection), toast
  layouts/    AppLayout = Topbar (workspace switcher, Ctrl-K search, running timer,
              notifications, profile) + IconRail + Sidebar (channels & spaces tree) + Outlet
              AdminLayout = superadmin panel shell
  components/ tasks/ (TaskTable grouped by status, KanbanBoard with HTML5 DnD, pickers)
              comments/ (CommentSection + MentionInput with @autocomplete)
              chat/, notifications/, search/ (command palette), invites/, github/, ui/
  pages/      auth/ (login, activate-invite, forgot/reset) · app/ (dashboard, workspaces,
              workspace detail, project, task, list=My Work, board, sprints, chat,
              notifications, settings) · admin/ (platform, organizations)
```

Routing: `/login`, `/activate-invite`, `/forgot-password`, `/reset-password` are public; `/app/*` requires auth; `/admin/*` additionally requires `is_platform_superadmin`. Session bootstrap tries the refresh cookie on load, so reloads keep you signed in.

## Security checklist (implemented)

- bcrypt password hashing; JWT HS256 with short expiry; refresh rotation + family revocation on reuse
- Invite/reset tokens stored only as SHA-256 hashes, single-use, expiring
- Permission check on every protected route; 404-over-403 for invisible resources
- Rate limiting (slowapi) on login/google/refresh/forgot/reset/invite endpoints
- Upload validation (size cap, MIME allowlist, dangerous-extension blocklist) and ACL check before download; local storage path-traversal guard
- GitHub webhook HMAC-SHA256 verification; duplicate delivery dedup
- No account enumeration on forgot-password; same response either way
- ORM-only data access (no raw SQL string building); Pydantic validation on all input
- Secure cookie flags in production (`ENVIRONMENT=production`)
