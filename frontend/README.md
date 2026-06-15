# FlowDesk UI

React frontend for **FlowDesk** — an invitation-only B2B work management platform
(projects, sprints, chat, whiteboards, forms, time tracking, Google Workspace and
GitHub integrations) in a pitch-black, ClickUp-inspired workspace.

The API (FastAPI/PostgreSQL) lives in its own repository:
[`flowdesk_API`](https://github.com/yanthraa-information-systems/flowdesk_API).

## Stack

React 18 · Vite · TypeScript · Tailwind CSS · React Router · TanStack Query ·
Zustand · native WebSocket client.

## Local development

```bash
# from the workspace root:
cp .env.example .env        # set VITE_GOOGLE_CLIENT_ID (leave VITE_API_URL empty)
npm install
npm run dev                 # http://localhost:5173
```

The dev server loads `VITE_*` variables from the workspace root `.env` and proxies
`/api/*` (including the WebSocket) to `http://localhost:8000`, so run the API
locally alongside it. Demo accounts are seeded by the API repo's `seed.py`.

## Deploying on Vercel

- **Framework preset:** Vite (build `npm run build`, output `dist/`) — auto-detected.
- `vercel.json` ships the SPA fallback rewrite so client-side routes deep-link correctly.
- **Environment variables** (Project → Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | the deployed API origin, e.g. `https://flowdesk-api.onrender.com` |
| `VITE_GOOGLE_CLIENT_ID` | the Google OAuth web client id (same one the API uses) |

On the API side, set `FRONTEND_URL` to this deployment's URL (CORS + email links)
and add the Vercel domain to the Google OAuth client's authorized JavaScript origins.

## Repository layout

```
src/
  components/   # task views (list/board/calendar/gantt/table), comments, chat,
                # github feed, invite modal, profile drawer, ui kit, brand icons
  layouts/      # icon rail, section sidebars, topbar, app/admin shells
  lib/          # api client (auto-refresh), ws client, queries, types, utils
  pages/        # auth · app (dashboard, planner, projects, sprints, chat, teams,
                # whiteboards, forms, timesheet, app center…) · admin · public forms
  stores/       # zustand: auth, ui, workspace, toasts
```
