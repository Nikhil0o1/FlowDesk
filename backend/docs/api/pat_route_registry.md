# PAT route registry

Generated from FastAPI routes that declare `@pat_allow`.

| Methods | Path | Scopes | Authz class | Rate | Tenant resolution |
|---------|------|--------|-------------|------|-------------------|
| GET | `/api/v1/auth/me` | profile:read | principal | standard | No tenant; returns authenticated user only |
| GET | `/api/v1/integrations/realtime` | realtime:read | principal | standard | No tenant; returns Integration WebSocket connection metadata for the PAT user |
| POST | `/api/v1/mcp/audit` | mcp:audit | principal | standard | MCP sidecar tool-invocation audit only |
| GET | `/api/v1/me/tasks` | tasks:read | principal | standard | Tasks visible to user across memberships (no workspace restriction) |
| GET | `/api/v1/me/time-entries` | time:read | principal | standard | Authenticated user's time entries across memberships |
| GET | `/api/v1/organizations` | organizations:read | principal | standard | Membership-filtered org list for PAT user |
| GET | `/api/v1/organizations/{org_id}/workspaces` | projects:read | tenant | standard | Path organization_id + org membership |
| GET | `/api/v1/projects/{project_id}` | projects:read | project | standard | Path project → workspace → org; project access |
| GET | `/api/v1/projects/{project_id}/statuses` | projects:read | project | standard | Path project → workspace → org; project access |
| GET | `/api/v1/projects/{project_id}/tasks` | tasks:read | project | standard | Project membership + task visibility |
| POST | `/api/v1/projects/{project_id}/tasks` | tasks:write | project | standard_write | Project membership + task create permission |
| GET | `/api/v1/search` | search:read | principal | expensive_read | Results filtered by PermissionService visibility |
| DELETE | `/api/v1/tasks/{task_id}` | tasks:write | object | standard_write | Task → project → org; object-level RBAC |
| GET | `/api/v1/tasks/{task_id}` | tasks:read | object | standard | Task → project → org; object-level RBAC |
| PATCH | `/api/v1/tasks/{task_id}` | tasks:write | object | standard_write | Task → project → org; object-level RBAC |
| POST | `/api/v1/tasks/{task_id}/assignees` | tasks:write | object | standard_write | Task object auth for assignee management |
| DELETE | `/api/v1/tasks/{task_id}/assignees/{user_id}` | tasks:write | object | standard_write | Task object auth for assignee management |
| GET | `/api/v1/tasks/{task_id}/comments` | comments:read | object | standard | Task object auth |
| POST | `/api/v1/tasks/{task_id}/comments` | comments:write | object | standard_write | Task object auth |
| GET | `/api/v1/tasks/{task_id}/time-entries` | time:read | object | standard | Task → project → org |
| POST | `/api/v1/tasks/{task_id}/time-entries` | time:write | object | standard_write | Task → project → org |
| POST | `/api/v1/tasks/{task_id}/timer/start` | time:write | object | standard_write | Task → project → org |
| GET | `/api/v1/timer/current` | time:read | principal | standard | Current user's running timer |
| POST | `/api/v1/timer/stop` | time:write | principal | standard_write | Stops current user's running timer |
| GET | `/api/v1/workspaces/{workspace_id}/projects` | projects:read | workspace | standard | Path workspace → organization; membership |

> Phase 1 PAT scopes restrict operations but not individual workspaces or projects. Resource restrictions are not supported.
