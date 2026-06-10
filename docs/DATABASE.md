# Database Schema

PostgreSQL via SQLAlchemy 2 + Alembic. Conventions:

- **UUID primary keys** everywhere (`id`), generated app-side.
- **`created_at` / `updated_at`** on every table (server defaults, auto-touch on update).
- **Soft delete** (`deleted_at`) on user-facing content; queries filter `deleted_at IS NULL`. Lookups on soft-deleted or invisible rows return 404.
- Status/role fields are short strings constrained by Pydantic validation (not DB enums) to keep migrations cheap; allowed values listed per table below.
- Indexes on all FKs used in lookups plus search-heavy fields (`tasks.title`, `tasks.due_date`, GIN on `tasks.labels`, composite indexes noted below).

Migrations live in `backend/migrations/` (initial schema: `80c75fb5fc5c`). Run `alembic upgrade head`.

## Identity & auth

### users
| Column | Notes |
| --- | --- |
| email | unique, indexed, lowercase |
| hashed_password | bcrypt; **nullable** (SSO-only accounts possible) |
| is_active | deactivation kills login + token refresh |
| is_platform_superadmin | the only global role flag in the system |
| email_verified_at, last_login_at | timestamps |
| auth_provider | `password` \| `google` |
| google_sub | unique Google subject id, set on first Google login |

### profiles — 1:1 with users
full_name, avatar_url, title, timezone, phone, about.

### refresh_tokens
token_hash (unique, SHA-256 of the raw cookie value), **family_id** (session lineage for reuse detection), expires_at, revoked_at, replaced_by_hash, user_agent, ip_address.

### password_reset_tokens
token_hash (unique), expires_at, used_at — single-use.

## Tenancy & membership

### organizations
name, slug (unique), logo_url, **is_disabled/disabled_at** (superadmin kill-switch — blocks all member access), settings JSONB, plan + seats (billing placeholders).

### organization_members — `UNIQUE(organization_id, user_id)`
role: `owner` \| `member`; joined_at.

### workspaces
organization_id FK, name, description, color, icon, is_archived/archived_at, created_by.

### workspace_members — `UNIQUE(workspace_id, user_id)`
role: `admin` \| `member`.

### spaces
workspace_id FK, name, color, icon, position.

### projects — `UNIQUE(workspace_id, key)`
space_id + workspace_id (denormalized for permission queries), name, **key** (e.g. `PHX` → refs like `PHX-12`), description, color, position, is_archived, **next_task_number** (per-project counter claimed under row lock).

### project_members — `UNIQUE(project_id, user_id)`
role: `admin` \| `member` \| `viewer`.

### task_lists
project_id FK, name, position.

## Tasks

### custom_statuses
project_id FK, name, color, **category**: `todo` \| `in_progress` \| `done` \| `cancelled`, position. Four defaults created with each project (To Do, In Progress, In Review, Done). `category=done` drives `completed_at`.

### tasks — `UNIQUE(project_id, number)`; indexes: due_date, title, GIN(labels)
| Column | Notes |
| --- | --- |
| list_id | nullable FK to task_lists |
| **parent_task_id** | self-FK — subtasks are tasks (one nesting level enforced) |
| number | per-project sequence → ref `KEY-number` |
| title, description | |
| priority | `urgent` \| `high` \| `normal` \| `low` (nullable) |
| status_id | FK custom_statuses |
| task_type | `task` \| `bug` \| `story` \| `epic` |
| start_date, due_date | dates |
| story_points, position, labels (JSONB array) | |
| is_archived, completed_at, created_by | |

### task_assignees — `UNIQUE(task_id, user_id)` (multiple assignees)
assigned_by FK.

### task_dependencies — `UNIQUE(task_id, depends_on_task_id)`
direct circular dependency rejected at API level.

### task_attachments
file_name, **storage_key** (local path or S3 key), mime_type, size_bytes, uploaded_by, soft delete.

### recurring_tasks
project_id, list_id, source_task_id, frequency `daily|weekly|monthly`, interval, **template JSONB** (title/description/priority/type/labels/points/assignee_ids/due_in_days), next_occurrence_at, last_created_at, is_active. Consumed by the `recurring_task_generation` cron.

## Collaboration

### comments
task_id, author_id, **parent_comment_id** (one reply level), body (mention markup `@[Name](uuid)`), soft delete.

### mentions
mentioned_user_id, created_by, comment_id **or** chat_message_id.

### notifications — index `(user_id, read_at)`
type (see list below), title, body, **data JSONB** (deep-link ids: task_id/sprint_id/invite_token/url…), read_at, workspace_id/project_id scope.
Types: `user_onboarded, workspace_invite, project_invite, task_assigned, comment_mention, chat_mention, comment_reply, due_date_reminder, task_overdue, sprint_started, sprint_completed, github_pr_opened, github_pr_merged, github_commit_pushed`.

### activity_logs — indexes `(workspace_id, created_at)`, `(project_id, created_at)`
workspace_id, project_id, task_id, actor_id, action (`task.created`, `github.push`…), data JSONB. Powers project activity feeds.

## Chat

### chat_channels
workspace_id, optional project_id, name, description, is_private, is_direct (reserved for DMs), created_by, soft delete.

### chat_members — `UNIQUE(channel_id, user_id)`
role `admin|member`. Public channels auto-join workspace members on first open.

### chat_messages
channel_id, author_id, parent_message_id (threads), body, edited_at, soft delete.

### message_reads — `UNIQUE(channel_id, user_id)`
One row per user per channel: last_read_message_id + last_read_at → O(1) read receipts and unread counts.

## Time & sprints

### time_entries — index `(user_id, ended_at)` for the running-timer lookup
task_id, user_id, started_at, **ended_at NULL = running** (one running entry per user enforced), duration_seconds, description, is_manual, stopped_by_system (set by the abandoned-timer cron).

### sprints
workspace_id, optional project_id, name, goal, start/end dates, status `planned|active|completed` (one active per workspace+project), **scrum_master_id** (scoped responsibility, not a role), started_at/completed_at.

### sprint_tasks — `UNIQUE(sprint_id, task_id)`
### standup_updates — `UNIQUE(sprint_id, user_id, for_date)`
yesterday / today / blockers text; upserts per day.

## Integrations & platform

### invites — index `(email, status)`
email, **token_hash** (unique, SHA-256), invited_by, scope `organization|workspace|project`, role, organization_id (+ workspace_id/project_id per scope), status `pending|accepted|expired|revoked`, expires_at, accepted_at, existing_user_id (non-null ⇒ accept flow instead of activation). New invites revoke prior pending ones for the same email+target.

### github_installations
organization_id, installation_id (unique bigint), account_login/type, installed_by.

### github_repositories
installation FK, workspace_id/project_id link targets, repo_id, repo_full_name, default_branch, is_active, connected_by.

### github_events — index `(repository_id, created_at)`
event_type `push|pull_request|issues`, action (incl. derived `merged`), actor_login, trimmed payload JSONB (summary/url/title/number/ref/commit_count), **task_id** (linked when `KEY-123` found in commit/PR/issue text), delivery_id (unique → webhook dedup).

### audit_logs — indexes `(organization_id, created_at)`, `(action)`
organization_id (**NULL = platform-level**, superadmin-visible), actor_id, action, target_type/target_id, data JSONB, ip_address. Written for auth events, invites, role changes, org/workspace/project/space lifecycle, sprint lifecycle, GitHub config, superadmin actions.

### cron_job_logs — index `(job_name, created_at)`
job_name, started_at/finished_at, status `running|success|failed`, items_processed, message (error text on failure).

## Entity relationship sketch

```
organizations ─< organization_members >─ users ── profiles
      │                                    │
      └─< workspaces ─< workspace_members >┤
              │                            │
              ├─< spaces ─< projects ─< project_members >─┘
              │               │
              │               ├─< task_lists ─< tasks (self-ref parent_task_id)
              │               │                  ├─< task_assignees
              │               │                  ├─< task_dependencies
              │               │                  ├─< task_attachments
              │               │                  ├─< comments ─< mentions
              │               │                  └─< time_entries
              │               ├─< custom_statuses
              │               └─< recurring_tasks
              ├─< chat_channels ─< chat_members / chat_messages / message_reads
              ├─< sprints ─< sprint_tasks / standup_updates
              └─< activity_logs
organizations ─< invites · github_installations ─< github_repositories ─< github_events
audit_logs · cron_job_logs · notifications (per-user)
```
