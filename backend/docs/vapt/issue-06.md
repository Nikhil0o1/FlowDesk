## Remediation delivered on `development`

**Commit:** [`18d99e7`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/18d99e77c43dd2bf7b0fbe1bd3b65e811f69c98a)

### Root cause
Default `SECRET_KEY` could be used in production (fail-open at startup). Access JWTs did not enforce standard `iss` / `aud` claims in all code paths.

### Fix
- JWT access + 2FA challenge tokens include `iss` (`JWT_ISSUER`) and `aud` (`JWT_AUDIENCE`); decode validates both.
- Production config validator rejects default `SECRET_KEY` and default `SUPERADMIN_PASSWORD`.
- `validate_runtime_config()` fails fast on boot if production uses default secret or `DEBUG=true`.

**Files:** `app/core/security.py`, `app/core/config.py`, `app/core/lifecycle.py`

### Pentester re-test
1. Start API with `ENVIRONMENT=production` and default `SECRET_KEY` → process **exits with error**.
2. Issue a token, mutate `aud` or `iss` → `decode_access_token` rejects it.
3. Confirm production env uses a strong unique `SECRET_KEY`.

---

## Closing checklist

- [x] Root cause identified and patched in code
- [ ] Regression test added (unit / integration)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging and check the boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
