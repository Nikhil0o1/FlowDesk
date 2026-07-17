## Remediation delivered on `development`

**Commit:** [`18d99e7`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/18d99e77c43dd2bf7b0fbe1bd3b65e811f69c98a)

### Root cause
`seed.py` ran on deploy and **re-hashed superadmin passwords on every run** (`super1.hashed_password = hash_password(...)`), resetting accounts to env/default credentials — effectively a standing backdoor if defaults were known.

### Fix
- Introduced `ensure_superadmin()` — creates superadmin **once**; existing accounts keep their password hash (only flags `is_platform_superadmin` / `is_active` are synced).
- Removed unconditional password reset for the secondary superadmin; it is created only when `EXTRA_SUPERADMIN_PASSWORD` is set in env.
- Deploy build script no longer runs seed by default — `seed.py` runs only when `SEED_ON_DEPLOY=true` (see #5).
- Production startup rejects default `SUPERADMIN_PASSWORD` via config guardrails.

**Files:** `seed.py`, `scripts/render_build.sh`, `app/core/config.py`

### Pentester re-test
1. Deploy / run `python seed.py` twice against a DB with an existing superadmin whose password was changed manually.
2. Confirm login still works with the **changed** password (not reset to default).
3. Confirm production deploy with `SEED_ON_DEPLOY` unset does **not** invoke `seed.py`.

---

## Closing checklist

- [x] Root cause identified and patched in code
- [ ] Regression test added (unit / integration)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging and check the boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
