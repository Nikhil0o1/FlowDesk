# VAPT remediation closure checklist

Repository: [flowdesk_API](https://github.com/yanthraa-information-systems/flowdesk_API)

Track against open issues: https://github.com/yanthraa-information-systems/flowdesk_API/issues

## Issue closure matrix

| # | Severity | Finding | Fix | Verify |
|---|----------|---------|-----|--------|
| 1 | High | Attachment download bypasses per-task ACL | `require_task_view()` on download/presigned URL; `require_task_edit()` on upload/delete | Private-task attachment returns 404 for non-shared project member |
| 2 | Critical | `seed.py` resets superadmin passwords every deploy | Create-once superadmins; never overwrite existing password hashes; seed gated behind `SEED_ON_DEPLOY` | Redeploy without env var does not reset passwords |
| 3 | High | Swagger/OpenAPI public in production | `docs_url` / `openapi_url` disabled when `DEBUG=false`; startup rejects `DEBUG=true` in production | `/api/docs` and `/openapi.json` return 404 in prod |
| 4 | High | `connect_repository` cross-tenant | Require installation `organization_id` matches target workspace org | Cannot link installation from org A to project in org B |
| 5 | High | Deploy runs migrations/seed unconditionally | `render_build.sh` runs repair + migrate; seed only when `SEED_ON_DEPLOY=true` | Production deploy succeeds without re-seeding |
| 6 | Medium | Default JWT secret / missing aud+iss | Production guardrails on `SECRET_KEY`; JWT includes and validates `iss`/`aud` | App refuses to boot with default secret in production |
| 7 | Medium | OAuth tokens plaintext at rest | `token_vault.seal()` / `reveal()` for Google + GitHub tokens | New tokens stored with `enc:v1:` prefix |
| 8 | Medium | Task `list_id` / assignees not scope-validated | Validate list belongs to project; assignees must be project members | Cross-project list/assignee rejected with 400 |
| 9 | Medium | Whiteboard duplicate/patch by any member | Creator or workspace admin required to edit/duplicate | Regular member gets 403 on PATCH/duplicate |

## Post-deploy verification

- [ ] `ENVIRONMENT=production`, `DEBUG=false`, strong `SECRET_KEY` set on Render
- [ ] `SEED_ON_DEPLOY` unset (or `false`) on production API service
- [ ] Build command: `bash scripts/render_build.sh`
- [ ] `alembic current` shows head revision
- [ ] Spot-check private task attachment download (expect 404)
- [ ] Spot-check `/api/docs` (expect 404)
- [ ] Rotate any credentials exposed during VAPT / debugging

## GitHub issue comments

Per-issue closure comments (root cause, fix, pentester re-test steps, closing checklist) live in:

| Issue | File |
|-------|------|
| #1 Attachment ACL | [`docs/vapt/issue-01.md`](vapt/issue-01.md) |
| #2 Seed superadmin | [`docs/vapt/issue-02.md`](vapt/issue-02.md) |
| #3 Swagger in prod | [`docs/vapt/issue-03.md`](vapt/issue-03.md) |
| #4 GitHub cross-tenant | [`docs/vapt/issue-04.md`](vapt/issue-04.md) |
| #5 Deploy migrations | [`docs/vapt/issue-05.md`](vapt/issue-05.md) |
| #6 JWT secret / aud+iss | [`docs/vapt/issue-06.md`](vapt/issue-06.md) |
| #7 OAuth encryption | [`docs/vapt/issue-07.md`](vapt/issue-07.md) |
| #8 Task scope validation | [`docs/vapt/issue-08.md`](vapt/issue-08.md) |
| #9 Whiteboard authz | [`docs/vapt/issue-09.md`](vapt/issue-09.md) |

Post all comments to GitHub (requires `repo` scope token):

```bash
python scripts/post_vapt_issue_comments.py
```

## GitHub issue comment (template)

```
Fixed on `development` in commit <sha>.

**Root cause:** <one line>
**Remediation:** <one line>
**Verification:** <how you tested>

See docs/VAPT_CLOSURE.md#issue-closure-matrix for the full checklist.
```
