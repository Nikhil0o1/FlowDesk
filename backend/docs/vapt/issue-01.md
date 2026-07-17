## Remediation delivered on `development`

**Commit:** [`512a30c`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/512a30c)

### Root cause
`GET /api/v1/attachments/{id}/download` (and presigned URL) checked only **project-level** access via `require_project_view()`. Private tasks restrict visibility to creator, assignees, and explicit share members — a project member who is not on that ACL could still download attachments (BOLA / broken object-level authorization).

### Fix
- Centralized attachment/task loading in `_load_task_or_404` and `_load_attachment_or_404` so every route enforces the same per-task ACL.
- `download_attachment` and `get_attachment_url` call `perms.require_task_view(task)` before serving bytes or a URL.
- Upload/delete paths call `perms.require_task_edit(task)` (private-task viewers get **403**, unauthorized download gets **404** to avoid leaking existence).

**Files:** `app/api/v1/attachments.py`

### Regression tests added
- `app/tests/integration/test_attachments.py` — private-task download/url blocked for unshared project member; upload/delete blocked; shared viewer can download.
- `app/tests/security/test_attachment_acl.py` — IDOR regression (VAPT #1 pentester scenario + post-share allow).

### Pentester re-test
1. Create a **private** task in a project with at least two project members (A and B).
2. A creates the task and uploads an attachment; do **not** share with B.
3. As B, call `GET /api/v1/attachments/{id}/download` → expect **404** (not 200).
4. As B, call `GET /api/v1/attachments/{id}/url` → expect **404**.
5. As B, `POST /api/v1/tasks/{id}/attachments` → expect **403**.
6. Share task with B (viewer) or assign B → download succeeds (**200**).

---

## Closing checklist

- [x] Root cause identified and patched in code
- [x] Regression test added (integration + security)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging/production and check the deployment boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
