# FlowDesk API Security

This document is the maintainability map for FlowDesk authentication and public API security. Credential mechanics are detailed in [API_CREDENTIALS.md](API_CREDENTIALS.md). The PAT route inventory is generated in [api/pat_route_registry.md](api/pat_route_registry.md).

## Threat model (API / PAT / OAuth apps)

| Asset | Threat | Control |
|-------|--------|---------|
| PAT secret | Leak via logs, audit, responses | One-time display; digests only in DB; audit stores ids/scopes |
| OAuth `client_secret` | Impersonate app at token exchange | Pepped HMAC digest; regenerate; org-admin only; exact redirect allowlist |
| OAuth auth code | Replay / theft | Short TTL, single-use, bound to `client_id` |
| Stolen PAT | Impersonation within user RBAC | Scopes ∩ RBAC; default-deny route allowlist; revoke / expire |
| Stolen DB digests | Offline verification | HMAC pepper map (`API_KEY_PEPPERS`); versioned peppers |
| Cross-tenant probe | Read other orgs’ objects | `PermissionService` object/tenant checks |
| Credential stuffing / abuse | DoS / brute force | IP + per-PAT + per-target-org Redis limits (`fd:rl:*`) |
| Scope confusion | Over-privileged automation | Strict scopes (write ⇏ read); create defaults to `[]` |
| Auth fallback | Cookie/JWT bypass of PAT scopes | PAT-shaped Bearer never falls through to JWT |
| Route expansion | Accidental public surface growth | `@pat_allow` + startup inventory + CI registry doc |

## Production configuration (required)

| Variable | Requirement |
|----------|-------------|
| `API_KEY_PEPPERS` | Non-empty JSON object `{"1":"<secret>",...}` — validated at startup |
| `API_KEY_PEPPER_CURRENT` | Integer version that **must exist** in the map |
| `REDIS_URL` | Required for multi-instance PAT rate limiting (fail-closed when set and unreachable) |
| `SECRET_KEY` / `DEBUG=false` | Existing production guards |

Startup fails if peppers are missing, not JSON, empty map, or `CURRENT` is absent from the map.

## Authentication precedence

1. Missing `Authorization` → `401 invalid_credentials`
2. Bearer matches `fd_pat_` or `fd_live_` → PAT only (no JWT fallback)
3. Else → JWT access token

Failed PAT cases share one external body: `invalid_credentials`. Scope/route denials: `insufficient_scope` / `pat_not_allowed`.

## Phase 1 public surface

Only routes listed in `pat_route_registry.md` accept PATs. Expanding the surface requires:

1. Individual security review (contract, tenant + object auth, pagination, sensitive fields)
2. `@pat_allow` with ≥1 scope, `authz_class`, `rate_category`
3. Regenerating the inventory (`scripts/generate_pat_route_registry.py`)
4. Tests for scope denial and RBAC

## Known product limitations (not backend blockers)

- No workspace/project resource restrictions on PATs
- No org-owned service accounts (Model B)
- API Keys settings UI / DX polish
- Non–Phase-1 MCP tools remain `pat_not_allowed` until reviewed

## Operational jobs (existing Celery worker/beat)

| Job | Purpose |
|-----|---------|
| `pat_apply_delayed_revocations` | Stamp `revoked_at` after rotation grace |
| `pat_cleanup_expired` | Hygiene revoke for expired rows |
| `pat_flush_denial_audits` | Aggregate high-frequency denials into audit |
| `pat_pepper_migration_report` | Count tokens per pepper version |

Verify rejects `revoke_at <= now` even if Celery is delayed.

## Related documents

- [Penetration test checklist](PENTEST_CHECKLIST.md)
- [API credentials](API_CREDENTIALS.md)
- [PAT route registry](api/pat_route_registry.md)
