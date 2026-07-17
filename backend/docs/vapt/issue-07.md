## Remediation delivered on `development`

**Commit:** [`18d99e7`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/18d99e77c43dd2bf7b0fbe1bd3b65e811f69c98a)

### Root cause
Google Calendar and GitHub OAuth **access/refresh tokens** were stored as plaintext in PostgreSQL (`calendar_connections`, `github_connections`).

### Fix
- Added `app/services/token_vault.py` — Fernet encryption (key derived from `SECRET_KEY`) with `enc:v1:` prefix.
- **Write path:** tokens sealed on OAuth callback and token refresh (`calendar.py`, `github.py`, `google_service.py`).
- **Read path:** tokens revealed only in memory when calling provider APIs.
- Legacy plaintext rows remain readable (transparent migration on next reconnect/refresh).

**Files:** `app/services/token_vault.py`, `app/services/google_service.py`, `app/api/v1/calendar.py`, `app/api/v1/github.py`, `app/api/v1/tasks.py`

### Pentester re-test
1. Connect Google or GitHub OAuth on staging.
2. Inspect DB row — `access_token` should start with `enc:v1:` (not a raw provider token).
3. Confirm calendar/GitHub features still work after reconnect.

---

## Closing checklist

- [x] Root cause identified and patched in code
- [ ] Regression test added (unit / integration)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging and check the boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
