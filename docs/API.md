# API Reference

Base URL: `http://localhost:8000/api/v1` · Interactive docs (dev): `http://localhost:8000/api/docs`

- **Auth**: `Authorization: Bearer <access_token>` on everything except the public auth endpoints and the GitHub webhook. Refresh token travels only as the httpOnly cookie `flowdesk_refresh`.
- **Pagination**: list endpoints accept `page` (1-based) and `page_size`, and return `{items, total, page, page_size}`.
- **Errors**: `{"detail": "message"}` with proper status codes; validation errors are FastAPI's 422 shape. Resources you can't see return **404**.
- **Rate limits** (per IP): login/google 10/min · refresh 60/min · forgot/reset 5/min · invites 20/min.

## Auth — `/auth`

| Method & path | Auth | Description |
| --- | --- | --- |
| POST `/auth/login` | — | Email+password → `{access_token, expires_in, user}` + refresh cookie |
| POST `/auth/google` | — | `{id_token}` from Google Identity Services; **existing users only** |
| POST `/auth/refresh` | cookie | Rotates the refresh cookie, returns a new access token. Reuse of a rotated token revokes the whole session family |
| POST `/auth/logout` | cookie | Revokes the refresh token, clears the cookie |
| POST `/auth/forgot-password` | — | `{email}`; always 200 (no enumeration); sends reset email |
| POST `/auth/reset-password` | — | `{token, password}`; single-use; revokes all sessions |
| GET `/auth/invite-preview?token=` | — | Invite metadata: org/target names, role, `existing_user`, `expired` |
| POST `/auth/activate-invite` | — | `{token, full_name, password}` — **new-user** activation; returns tokens (auto-login) |
| POST `/auth/accept-invite` | ✅ | `{token}` — **existing-user** accept (must be logged in as the invited email) |
| GET `/auth/me` | ✅ | Current user + profile |

## Users — `/users`

| | |
| --- | --- |
| PATCH `/users/me/profile` | Update full_name, title, timezone, phone, about, avatar_url |

## Organizations — `/organizations`

| | Permission |
| --- | --- |
| GET `/organizations` | member — my orgs with `my_role` |
| GET `/organizations/{id}` · PATCH | member · **owner** |
| GET `/organizations/{id}/members` | member |
| PATCH `/organizations/{id}/members/{user_id}` `{role}` | owner (guards last owner) |
| DELETE `/organizations/{id}/members/{user_id}` | owner |
| POST `/organizations/{id}/invites` `{email, role}` | owner — org-scope invite |
| GET `/organizations/{id}/invites` · DELETE `…/invites/{invite_id}` | owner — pending list / revoke |
| GET `/organizations/{id}/audit-logs` | owner — paginated |

## Workspaces

| | Permission |
| --- | --- |
| GET `/organizations/{org_id}/workspaces` | owner sees all; members see theirs |
| POST `/organizations/{org_id}/workspaces` | **org owner** (creates default `#general` channel) |
| GET `/workspaces/{id}` · PATCH | member · admin |
| POST `/workspaces/{id}/archive` · `/unarchive` · DELETE | **org owner only** |
| GET `/workspaces/{id}/members` | member |
| PATCH/DELETE `/workspaces/{id}/members/{user_id}` | admin |
| POST `/workspaces/{id}/invites` `{email, role: admin\|member}` | admin |

## Spaces / Projects / Lists / Statuses

| | Permission |
| --- | --- |
| GET/POST `/workspaces/{id}/spaces` | member / **ws admin** |
| PATCH/DELETE `/spaces/{id}` | ws admin |
| GET `/workspaces/{id}/projects?space_id=` | admins see all; members see **only assigned projects** |
| POST `/spaces/{id}/projects` `{name, key, …}` | ws admin (creates 4 default statuses + a list; creator becomes project admin) |
| GET/PATCH/DELETE `/projects/{id}` | view / project admin / ws admin |
| GET/POST `/projects/{id}/members`, DELETE `…/members/{user_id}` | project admin; user must already be in the org |
| POST `/projects/{id}/invites` `{email, role}` | project admin |
| GET/POST `/projects/{id}/lists`, PATCH/DELETE `/lists/{id}` | view / project admin |
| GET/POST `/projects/{id}/statuses`, PATCH/DELETE `/statuses/{id}` | view / project admin (delete blocked while in use) |
| GET `/projects/{id}/activity` | view — paginated activity feed (incl. GitHub) |

## Tasks

| | Notes |
| --- | --- |
| GET `/projects/{id}/tasks` | Filters: `status_id, priority, assignee_id, created_by, task_type, label, list_id, sprint_id, due=today\|week\|overdue, q, include_subtasks, include_archived`; sorting `sort_by` (position/created_at/updated_at/due_date/priority/title/number) + `sort_dir`; paginated |
| GET `/me/tasks` | Cross-project: `relation=assigned\|created`, `due`, `priority`, `task_type`, `include_completed` |
| POST `/projects/{id}/tasks` | `{title, description?, priority?, status_id?, task_type, list_id?, parent_task_id?, start_date?, due_date?, story_points?, labels[], assignee_ids[]}` — assigning notifies + emails; project-edit permission (viewers blocked) |
| GET `/tasks/{id}` | Detail: subtasks, dependencies + dependents, attachments, total tracked seconds |
| PATCH `/tasks/{id}` | Partial update; `clear_priority` / `clear_due_date` flags; status with `category=done` sets `completed_at`; emits `task.updated` |
| DELETE `/tasks/{id}` | Soft delete |
| POST `/tasks/{id}/assignees` `{user_ids[]}` · DELETE `…/assignees/{user_id}` | Multi-assignee; notifications + emails on assign |
| POST `/tasks/{id}/dependencies` `{depends_on_task_id}` · DELETE `…/dependencies/{dep_id}` | Same-project, anti-self, anti-circular |
| GET/POST `/projects/{id}/recurring-tasks` · DELETE `/recurring-tasks/{id}` | Template JSONB + frequency/interval/next_occurrence_at |

## Comments — mention markup `@[Name](<user-uuid>)`

| | |
| --- | --- |
| GET `/tasks/{id}/comments` | Paginated, with author info and reply counts |
| POST `/tasks/{id}/comments` | `{body, parent_comment_id?}` (one reply level). Parses mentions → mention rows + notifications + emails; reply notification to parent author; emits `comment.created` |
| PATCH `/comments/{id}` | Author only |
| DELETE `/comments/{id}` | Author, or project admin (moderation) |

## Notifications — `/notifications`

GET `` (`unread_only`, paginated) · GET `/unread-count` · POST `/{id}/read` · POST `/read-all`. New ones also arrive realtime as `notification.created`.

## Chat

| | |
| --- | --- |
| GET `/workspaces/{id}/channels` | Public channels + my private ones, with `unread_count`, `member_count`, `last_message_at` |
| POST `/workspaces/{id}/channels` | `{name, description?, is_private, project_id?, member_ids[]}` |
| PATCH/DELETE `/channels/{id}` | channel admin / ws admin |
| GET/POST `/channels/{id}/members`, DELETE `…/members/{user_id}` | members must be workspace members |
| GET `/channels/{id}/messages?before=` | Paginated history (public channels auto-join on first open) |
| POST `/channels/{id}/messages` | `{body, parent_message_id?}` — mentions notified+emailed (mentions only); broadcasts `chat.message.created` |
| POST `/channels/{id}/read` `{message_id}` | Read receipt; broadcasts `chat.read` |

Typing indicators are WebSocket-only: send `{"type":"chat.typing","channel_id":…}`.

## Time tracking

| | |
| --- | --- |
| POST `/tasks/{id}/timer/start` | 409 if you already have a running timer (one per user) |
| POST `/timer/stop` · GET `/timer/current` | Stop/inspect my running timer |
| POST `/tasks/{id}/time-entries` | Manual entry `{started_at, ended_at, description?}` |
| GET `/tasks/{id}/time-entries` · GET `/me/time-entries` | History (paginated) |
| DELETE `/time-entries/{id}` | Own entries (admins can moderate) |

## Sprints

| | Permission |
| --- | --- |
| GET/POST `/workspaces/{id}/sprints` (`?project_id&status`) | member / ws admin |
| GET/PATCH/DELETE `/sprints/{id}` | member / scrum-master-or-admin / ws admin |
| POST `/sprints/{id}/start` · `/complete` | **scrum master, ws admin, or org owner**; one active sprint per project; notifies + emails workspace members |
| GET/POST `/sprints/{id}/tasks` `{task_ids[]}` · DELETE `…/tasks/{task_id}` | member (edit rights on the task's project); completed sprints locked |
| GET `/sprints/{id}/burndown` | `{total_points, completed_points, points[{day, remaining, ideal}]}` |
| GET/POST `/sprints/{id}/standups` (`?for_date`) | One per user per day (upsert) |

## Search — `/search?q=&limit=`

Access-scoped global search → `{tasks[], projects[], comments[], users[]}` (users = people sharing an org with you).

## Attachments

POST `/tasks/{id}/attachments` (multipart `file`; size/MIME/extension validated) · GET `/attachments/{id}/download` (**permission re-checked before serving**) · DELETE `/attachments/{id}`.

## GitHub — `/github`

| | |
| --- | --- |
| POST `/github/webhook` | Public, HMAC-SHA256 verified (`X-Hub-Signature-256`); handles `push`, `pull_request`, `issues`, `ping`; dedups by delivery id; links `KEY-123` text refs to tasks; stores events, writes activity, notifies project members (PR opened/merged also email) |
| POST/GET `/github/organizations/{org_id}/installations` | org owner / member |
| POST `/github/repositories` | Connect repo → project or workspace (admin) |
| GET `/github/projects/{id}/repositories` · `/events` | view — repo list / event feed |
| DELETE `/github/repositories/{id}` | admin — disconnect |

## Platform admin — `/admin` (superadmin only; **metadata, never org content**)

| | |
| --- | --- |
| GET `/admin/stats` | org/user/workspace counts |
| GET `/admin/organizations?q=` | Paginated metadata: member/workspace/project/**task counts** (aggregates only) |
| POST `/admin/organizations` | `{name, slug, owner_email, plan?, seats?}` — creates org + sends owner onboarding invite |
| GET `/admin/organizations/{id}` | Metadata |
| POST `/admin/organizations/{id}/disable` · `/enable` | Kill-switch (members get 403 while disabled) |
| GET `/admin/audit-logs?action=` | Platform-wide audit trail |
| GET `/admin/cron-logs?job_name=` | Cron execution history |

## WebSocket — `GET /api/v1/ws?token=<access_token>`

Server→client envelope:

```json
{ "type": "task.updated", "workspace_id": "…", "project_id": "…", "task_id": "…", "payload": { } }
```

Types: `presence.state|online|offline`, `task.created|updated|deleted|assigned`, `comment.created|updated|deleted`, `mention.created`, `notification.created`, `chat.message.created`, `chat.typing`, `chat.read`, `timer.started|stopped`, `sprint.updated`, `github.event.created`, `pong`.

Client→server: `{"type":"ping"}`, `{"type":"chat.typing","channel_id":…}`, `{"type":"subscribe.channel","channel_id":…}` (membership verified).
