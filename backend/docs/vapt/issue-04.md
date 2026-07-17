## Remediation delivered on `development`

**Commit:** [`18d99e7`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/18d99e77c43dd2bf7b0fbe1bd3b65e811f69c98a)

### Root cause
Legacy `POST /api/v1/github/repositories` (`connect_repository`) verified org membership on the GitHub **installation** but did not ensure the target **project/workspace** belongs to the same organization — allowing cross-tenant repository binding.

### Fix
After resolving the target workspace (via `project_id` or `workspace_id`), the handler now compares `workspace.organization_id` to `installation.organization_id` and returns **403** on mismatch.

**Files:** `app/api/v1/github.py` — `connect_repository`

### Pentester re-test
1. Obtain a GitHub installation for **Org A**.
2. Attempt to connect it to a project in **Org B** via `POST /github/repositories`.
3. Expect **403** with message *"GitHub installation does not belong to this organization"*.

---

## Closing checklist

- [x] Root cause identified and patched in code
- [ ] Regression test added (unit / integration)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging and check the boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
