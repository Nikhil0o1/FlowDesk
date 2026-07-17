## Remediation delivered on `development`

**Commit:** [`18d99e7`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/18d99e77c43dd2bf7b0fbe1bd3b65e811f69c98a)

### Root cause
When `DEBUG=true` in production, FastAPI served `/api/docs`, ReDoc, and the OpenAPI schema to unauthenticated users, exposing the full API surface.

### Fix
- `docs_url` and `openapi_url` are **only enabled when `DEBUG=true`** (`app/main.py`).
- Application startup (`validate_runtime_config`) **raises** if `ENVIRONMENT=production` and `DEBUG=true`.
- Production must set `DEBUG=false` for the process to boot.

**Files:** `app/main.py`, `app/core/lifecycle.py`, `app/core/config.py`

### Pentester re-test
1. Deploy / run API with `ENVIRONMENT=production`, `DEBUG=false`.
2. `GET /api/docs` → **404**
3. `GET /openapi.json` → **404**
4. Confirm API refuses to start if `DEBUG=true` in production.

---

## Closing checklist

- [x] Root cause identified and patched in code
- [ ] Regression test added (unit / integration)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging and check the boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
