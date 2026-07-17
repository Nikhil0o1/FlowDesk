# FlowDesk MCP Server

Production-grade [Model Context Protocol](https://modelcontextprotocol.io) server for **FlowDesk**. Connect from **Cursor**, **Claude Desktop**, or any MCP client to automate tasks, inbox, search, and projects using your real FlowDesk permissions.

**Capabilities:** 49 tools · 3 prompts · 1 static resource + 3 URI templates (`flowdesk://…`)

## Recommended: one-click connect (production)

Normal users should **not** copy JWTs from the network tab or run curl.

1. Open **FlowDesk → Settings → Connections**
2. Click **Add to Cursor** (or copy the Claude Desktop config)
3. In Cursor: **Tools & MCP** → **Connect** on the FlowDesk server → approve in the browser

OAuth issues a scoped personal access token automatically. Revoke connections under Settings → Connections.

## Connect from Claude

Settings → Connections has a dedicated card per client. All three paths end at the same FlowDesk OAuth approval page.

**Claude Code (CLI + VS Code / JetBrains extensions)** — one command in any shell (PowerShell, bash, zsh):

```bash
claude mcp add --transport http flowdesk https://your-api.onrender.com/mcp --scope user
```

`--scope user` writes to `~/.claude.json`, shared by the CLI and the IDE extensions, so it works everywhere. Then authenticate with `/mcp` → flowdesk → Authenticate (or `claude mcp login flowdesk`). Note: Claude Code's login is separate from claude.ai — the FlowDesk OAuth approval uses the FlowDesk account, so the terminal's Claude account doesn't matter.

**Claude Desktop / claude.ai / mobile** — "Add to Claude" button opens the prefilled custom-connector dialog:

```text
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=FlowDesk&connectorUrl=<mcp-url>
```

Connectors are brokered through Anthropic's cloud, so the MCP URL must be publicly reachable — the UI warns when the URL is localhost. One add covers Desktop, web, and mobile; connectors added on claude.ai also load automatically in Claude Code when signed in with the same account.

Troubleshooting (stale/broken entries) — the UI exposes a reset block:

```bash
claude mcp remove flowdesk --scope user
claude mcp remove flowdesk --scope local
claude mcp remove flowdesk --scope project
claude mcp add --transport http flowdesk https://your-api.onrender.com/mcp --scope user
claude mcp list
```

### Run the remote MCP HTTP server

```bash
cd mcp
npm install
npm run build
FLOWDESK_API_URL=http://localhost:8000 npm run start:http
```

Default URL: `http://localhost:3100/mcp`

Set on the API (`.env`):

```env
MCP_PUBLIC_URL=http://localhost:3100
```

Production (colocated — **no second Render instance**):

1. Set on your **existing API** service:
   ```env
   MCP_SIDECAR_ENABLED=true
   ```
   Leave `MCP_PUBLIC_URL` empty — it defaults to `{BACKEND_URL}/mcp`.

2. Deploy. The build compiles `mcp/` and the start script runs the Node sidecar on `127.0.0.1:3100`; FastAPI proxies `/mcp` and `/icon.png`.

3. Cursor connects to `https://your-api.onrender.com/mcp`.

Local dev (separate processes — unchanged):

```bash
cd mcp && npm run build
FLOWDESK_API_URL=http://localhost:8000 npm run start:http
```

Set on the API (`.env`):

```env
MCP_SIDECAR_ENABLED=false
MCP_PUBLIC_URL=http://localhost:3100
```

Optional: run colocated locally with `MCP_SIDECAR_ENABLED=true` and only start the API (sidecar starts automatically via `scripts/render_start.sh`).

### Separate MCP service (optional)

If you later want a dedicated MCP host, deploy `mcp/Dockerfile` and set `MCP_PUBLIC_URL=https://mcp.your-domain.com` on the API with `MCP_SIDECAR_ENABLED=false`.

## Resources

MCP resources expose read-only JSON snapshots without a tool round-trip.

Cursor’s MCP panel typically shows **1 resource enabled** — the static entry below. The three URI templates are still available via `resources/templates/list` and `resources/read` when the agent uses parameterized URIs.

| URI | Description |
|-----|-------------|
| `flowdesk://user/me` | Current user + roles *(listed in resources/list)* |
| `flowdesk://task/{task_id}` | Task detail *(template)* |
| `flowdesk://project/{project_id}` | Project detail *(template)* |
| `flowdesk://workspace/{workspace_id}/projects` | Projects in workspace *(template)* |

## Prompts

Built-in workflow prompts (fetch context, then let the agent act):

| Prompt | Description |
|--------|-------------|
| `triage-my-inbox` | Walk Primary inbox notifications |
| `sprint-standup` | Standup summary from active sprint |
| `create-tasks-from-notes` | Parse notes into tasks in a project |

## Audit log

Every MCP tool call is logged server-side (tool name, args SHA-256 hash, status, duration). View recent activity under **Settings → Connections**. Revoking a PAT stops new calls immediately.

## Server icon

The HTTP server serves `GET /icon.png` and advertises `serverInfo.icons` in MCP initialize. Cursor may still show a letter placeholder until third-party icon support ships — the metadata is ready when it does.

## Developer fallback: local stdio + PAT

For debugging only:

```bash
cd mcp && npm install && npm run build
```

Create a PAT via **Settings → Connections** (or `POST /api/v1/users/me/api-tokens` with your session JWT).

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "flowdesk": {
      "command": "node",
      "args": ["d:/FLowDesk/mcp/dist/index.js"],
      "env": {
        "FLOWDESK_API_URL": "http://localhost:8000",
        "FLOWDESK_ACCESS_TOKEN": "fd_live_...",
        "FLOWDESK_ALLOW_DESTRUCTIVE": "false"
      }
    }
  }
}
```

## Tools

### Phase 1 — Core work (17 tools)

| Tool | Description |
|------|-------------|
| `flowdesk_whoami` | User + roles |
| `flowdesk_search` | Global search |
| `flowdesk_list_my_tasks` | Assigned / created / delegated |
| `flowdesk_get_task` | Task detail |
| `flowdesk_create_task` | Create task |
| `flowdesk_update_task` | Update task |
| `flowdesk_delete_task` | Delete (needs confirm + env flag) |
| `flowdesk_assign_task` | Add/remove assignees |
| `flowdesk_list_organizations` | Orgs |
| `flowdesk_list_workspaces` | Workspaces in org |
| `flowdesk_list_projects` | Projects in workspace |
| `flowdesk_get_project` | Project detail |
| `flowdesk_list_project_statuses` | All custom statuses for a project (use before setting `status_id`) |
| `flowdesk_add_comment` | Comment on task |
| `flowdesk_list_inbox` | Inbox notifications |
| `flowdesk_mark_notification_read` | Mark read |
| `flowdesk_clear_notification` | Clear notification |

### Phase 2 — Team & planning (19 tools)

| Tool | Description |
|------|-------------|
| `flowdesk_list_sprints` | List sprints in workspace |
| `flowdesk_get_sprint` | Sprint detail |
| `flowdesk_create_sprint` | Create sprint |
| `flowdesk_start_sprint` | Start planned sprint |
| `flowdesk_complete_sprint` | Complete active sprint |
| `flowdesk_list_sprint_tasks` | Tasks in sprint |
| `flowdesk_add_sprint_tasks` | Add tasks to sprint |
| `flowdesk_remove_sprint_task` | Remove task from sprint |
| `flowdesk_log_time_on_task` | Manual time entry |
| `flowdesk_start_timer` | Start timer on task |
| `flowdesk_stop_timer` | Stop running timer |
| `flowdesk_get_current_timer` | Current timer |
| `flowdesk_list_my_time_entries` | Your time entries |
| `flowdesk_list_project_members` | Project members (read-only) |
| `flowdesk_list_workspace_members` | Workspace members (read-only) |
| `flowdesk_list_templates` | Workspace templates |
| `flowdesk_apply_template` | Apply template |
| `flowdesk_list_channels` | Chat channels |
| `flowdesk_post_channel_message` | Post chat message |

### Phase 3 — Power user (13 tools)

| Tool | Description |
|------|-------------|
| `flowdesk_list_documents` | List workspace documents |
| `flowdesk_get_document` | Document detail + content |
| `flowdesk_create_document` | Create doc or wiki |
| `flowdesk_update_document` | Update document |
| `flowdesk_list_forms` | List intake forms |
| `flowdesk_get_form` | Form definition |
| `flowdesk_list_form_submissions` | Form submissions |
| `flowdesk_list_whiteboards` | List whiteboards |
| `flowdesk_get_whiteboard` | Whiteboard content |
| `flowdesk_get_project_github_connection` | GitHub connection status |
| `flowdesk_create_github_issue_for_task` | Link task to GitHub issue |
| `flowdesk_sync_github_issue_status` | Sync status from GitHub |
| `flowdesk_bulk_update_tasks` | Batch-update up to 25 tasks |

## Security

- Remote MCP uses OAuth 2.1 + PKCE (Cursor-compatible redirect URIs).
- PATs are hashed at rest; OAuth-created tokens appear as "MCP connection" in Settings.
- PATs **cannot** create other PATs (JWT required for token management).
- Task deletion is off by default (`FLOWDESK_ALLOW_DESTRUCTIVE=false`).
- All actions go through FlowDesk API + `PermissionService` — same rules as the UI.
