# FlowDesk API Credentials

## Credential models

### Model A — Personal Access Tokens

User-bound PATs act as the approving user (scripts, MCP, and OAuth access tokens):

`effective = token.scopes ∩ route.required_scopes ∩ PermissionService(user) ∩ tenant membership`

### Model B — Organization service keys

Deferred. Not implemented.

### Model C — Integration OAuth apps (Custom Apps)

Org-admin-created apps for third-party integrations:

- `client_id` / `client_secret` — app credentials for the integrator’s server environment (secret stored as peppered HMAC-SHA-256 digest, format `fd_appsec_<kid>_<secret>`)
- Authorize: `GET /api/v1/oauth/integrations/authorize?client_id&redirect_uri&state`
- Token: `POST /api/v1/oauth/integrations/token` JSON `{client_id, client_secret, code}` → `{access_token}` (Model A PAT bound to the authorizing user)
- Redirect URIs must be registered exactly on the app (https or localhost)
- Personal PATs are for individual/testing use; Custom Apps are for apps that other people authorize

### Resource restrictions (Phase 1 limitation)

**Phase 1 PAT scopes restrict operations but not individual workspaces or projects.**
Resource restrictions are not supported and must not appear in the UI or API documentation.
A `tasks:read` token can read tasks in every workspace the user can access.

---

## PAT secrets vs password hashing

- PAT secrets are server-generated high-entropy random material (~48 bytes urlsafe).
- Digests use SHA-256 (legacy full token) or HMAC-SHA-256 (v1 secret + pepper).
- This is **not** comparable to password storage. Passwords are low-entropy and need slow KDFs (Argon2/bcrypt).
- Webhook endpoint secrets use Fernet (reversible) so the server can sign deliveries.
  Outbound deliveries use Stripe-style HMAC: `X-FlowDesk-Signature: t=<unix>,v1=<hex>`
  over `{timestamp}.{raw_body}`. See in-app Developer Docs → Webhooks for verification samples.
- Integration WebSockets authenticate with the same PATs (`fd_live_…`) using scope `realtime:read`.
  Browser app WebSockets use short-lived tickets from a session JWT — PATs cannot mint those tickets.

---

## Token formats

| Format | Status |
|--------|--------|
| `fd_live_<public_key_id>_<secret>` | Current issuance |
| `fd_pat_<secret>` | Legacy; verify until rotated/revoked |

Legacy verification hashes the **entire raw token**: `SHA256(raw_token)`.
V1 verification looks up `public_key_id`, then `HMAC-SHA256(pepper[pepper_version], secret)`.

---

## Pepper version map

Configure an explicit version→secret map (not forever “current + previous” only):

- `API_KEY_PEPPERS` — JSON object, e.g. `{"1":"<secret>","2":"<secret>"}`
- `API_KEY_PEPPER_CURRENT` — integer version used for new tokens (default `1`)

Each token row stores `hash_version` and `pepper_version`. The verifier selects **only** that pepper; missing versions fail closed with uniform `401 invalid_credentials`.

| Mode | Behaviour |
|------|-----------|
| Online rehash | On successful verify, if `pepper_version < CURRENT`, re-HMAC and update in the same transaction as `last_used_at` |
| Forced rotation | Retire a version; Celery reports remaining tokens; users rotate; verifier rejects unknown versions |
| Retirement | Remove a version from the map only when zero tokens remain (or after forced revoke) |

---

## Scope rules (strict)

- Every PAT-enabled route declares **at least one** explicit scope.
- **Write does not imply read.** `tasks:write` alone cannot `GET` a task.
- No cross-resource implications (`projects:read` ⇏ `organizations:read`).
- Routes require the **intersection** of listed scopes (token must hold all of them).

### Phase 1 scopes

| Scope | Use |
|-------|-----|
| `profile:read` | `GET /auth/me` |
| `organizations:read` | List membership orgs |
| `projects:read` | Workspaces / projects / statuses |
| `tasks:read` / `tasks:write` | Tasks |
| `comments:read` / `comments:write` | Comments |
| `search:read` | Search |
| `time:read` / `time:write` | Time entries / timers |
| `mcp:audit` | MCP sidecar tool-invocation audit (`POST /mcp/audit`) |

### Default on create

New PATs default to **no scopes** (`[]`). MCP/OAuth clients must request scopes explicitly and obtain user consent. FlowDesk does not silently grant the Phase 1 set.

---

## Authentication precedence

1. Missing `Authorization` → `401 invalid_credentials`
2. Bearer matches PAT shape (`fd_pat_` or `fd_live_`) → **PAT flow only** (never JWT fallback)
3. Otherwise → JWT access token

All failed PAT cases (unknown id, wrong secret, expired, revoked, past `revoke_at`, missing pepper, inactive user) return the **same** body:

```json
{"error":{"code":"invalid_credentials","message":"Invalid authentication credentials."}}
```

Allowlist / scope denials:

```json
{"error":{"code":"pat_not_allowed","message":"This endpoint does not support API token authentication."}}
{"error":{"code":"insufficient_scope","message":"The API token does not have the required scope."}}
```

---

## Token rotation

| Rule | Behaviour |
|------|-----------|
| New token | New `public_key_id` + secret; `rotated_from_id` → old row |
| Scopes | Copied from old unless an explicit new set is passed |
| Expiry | Inherit remaining TTL of old token, capped by max lifetime (365 days) |
| Overlap | Old token valid for **5 minutes** (`revoke_at = now + grace`) |
| Delayed revoke | Celery sets `revoked_at` when `revoke_at <= now`; verify also rejects when `revoke_at <= now` |
| Immediate revoke | Sets `revoked_at` now; clears pending grace |
| Secret | New secret shown once; old secret never re-shown |

---

## Rate limiting (existing Redis)

Uses the shared `REDIS_URL` service. Keys are isolated with short TTLs:

- `fd:rl:ip:{ip}:{category}`
- `fd:rl:pat:{token_id}:{category}`
- `fd:rl:org:{organization_id}:{category}`

Per-organization limits use the **securely resolved target organization** for the request (path / workspace / project / object parent) — never the user’s “primary” org.

| Topic | Policy |
|-------|--------|
| Store outage | Fail-closed for PAT traffic when Redis is configured: `503` |
| Key expiry | TTL = window length |
| Client signal | `429` + `Retry-After` |
| Dev without Redis | In-memory only when explicitly allowed; not for production PAT |

---

## Audit

Durable (`audit_logs`): `pat.created`, `pat.rotated`, `pat.revoked`.

High-frequency denials (`pat.scope_denied`, `pat.route_denied`, expired/revoked attempts): aggregated / sampled via Redis + Celery flush — not one audit row per request.

Successful API calls: operational metrics / `last_used_at` only.

---

## Route authorization classes

Every `@pat_allow` route declares `authz_class`:

| Class | Meaning |
|-------|---------|
| `principal` | Bound to authenticated user only (e.g. `/me`) |
| `tenant` | Path `organization_id` + membership |
| `workspace` | Workspace → organization |
| `project` | Project → workspace → organization |
| `object` | Object (task/comment/time) → project → organization |

See [api/pat_route_registry.md](api/pat_route_registry.md) (generated from FastAPI routes at startup / CI).

Default-deny: undecorated routes reject PAT with `pat_not_allowed`.

See also [SECURITY.md](SECURITY.md) and [PENTEST_CHECKLIST.md](PENTEST_CHECKLIST.md).
