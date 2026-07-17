## Remediation delivered on `development`

**Commit:** [`18d99e7`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/18d99e77c43dd2bf7b0fbe1bd3b65e811f69c98a)

### Root cause
Render build ran `alembic upgrade head` and `python seed.py` unconditionally on every deploy. When DB schema already existed but `alembic_version` was empty, migrations re-ran from scratch (DuplicateTable). Seed also re-ran side effects (see #2).

### Fix
- `scripts/render_build.sh`: `ensure_migrations.py` → `alembic upgrade head` → seed **only if** `SEED_ON_DEPLOY=true`.
- `scripts/ensure_migrations.py` + `migrations/env.py`: if schema is at head but `alembic_version` is empty, stamp head before upgrade (prevents DuplicateTable on drifted DBs).
- Runtime `ensure_migrations_current()` warns/fails if DB revision ≠ head.

**Files:** `scripts/render_build.sh`, `scripts/ensure_migrations.py`, `migrations/env.py`, `app/core/migrations_check.py`

### Pentester / ops re-test
1. Set Render build command to `bash scripts/render_build.sh`.
2. Leave `SEED_ON_DEPLOY` unset → deploy succeeds without running seed.
3. DB with empty `alembic_version` but existing tables → build stamps head, upgrade is no-op.

---

## Closing checklist

- [x] Root cause identified and patched in code
- [ ] Regression test added (unit / integration)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging and check the boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
