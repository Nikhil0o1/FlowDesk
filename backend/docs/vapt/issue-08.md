## Remediation delivered on `development`

**Commit:** [`18d99e7`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/18d99e77c43dd2bf7b0fbe1bd3b65e811f69c98a)

### Root cause
Task create/update accepted `list_id` and `assignee_ids` without verifying they belong to the target project. A caller could reference another project's list or assign users outside the project — leaking private-task visibility via assignee ACL.

### Fix
- `validate_task_list()` — rejects `list_id` not owned by the project (**400**).
- `validate_assignee_ids()` — every assignee must be a **project member** (**400**).
- Applied on task create, update (`list_id`), recurring task create, and `assign_users()`.

**Files:** `app/services/task_service.py`, `app/api/v1/tasks.py`

### Pentester re-test
1. Create task in Project A with `list_id` from Project B → **400**.
2. Assign a user who is not a member of the project → **400**.
3. Valid list + valid project member → **201** / success.

---

## Closing checklist

- [x] Root cause identified and patched in code
- [ ] Regression test added (unit / integration)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging and check the boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
