## Remediation delivered on `development`

**Commit:** [`18d99e7`](https://github.com/yanthraa-information-systems/flowdesk_API/commit/18d99e77c43dd2bf7b0fbe1bd3b65e811f69c98a)

### Root cause
`update_whiteboard` and `duplicate_whiteboard` only required **workspace membership**, while `delete_whiteboard` correctly restricted to **creator or workspace admin**. Any member could PATCH another user's board or duplicate it.

### Fix
Added `_require_whiteboard_manage()` — same rule as delete: caller must be `board.created_by` **or** workspace admin. Applied to:
- `PATCH /api/v1/whiteboards/{board_id}`
- `POST /api/v1/whiteboards/{board_id}/duplicate`

**Files:** `app/api/v1/whiteboards.py` (lines ~47–50, ~115, ~173)

### Pentester re-test
1. User A creates a whiteboard in a shared workspace.
2. User B (regular member, not admin) calls `PATCH /api/v1/whiteboards/{id}` with a new name → **403**.
3. User B calls `POST /api/v1/whiteboards/{id}/duplicate` → **403**.
4. Workspace admin or User A → success.

---

## Closing checklist

- [x] Root cause identified and patched in code
- [ ] Regression test added (unit / integration)
- [ ] Re-tested in staging — vulnerability no longer reproducible
- [ ] Verified on production (where applicable)

**Assignee note:** Please confirm re-test on staging and check the boxes above before closing.

See also: [`docs/VAPT_CLOSURE.md`](https://github.com/yanthraa-information-systems/flowdesk_API/blob/development/docs/VAPT_CLOSURE.md)
