# Git hooks (flowdesk_ui)

Run once after clone:

```bash
bash scripts/install-githooks.sh
```

On Windows PowerShell:

```powershell
.\scripts\install-githooks.ps1
```

## Hooks

| Hook | When | Action |
|------|------|--------|
| **pre-commit** | `git commit` | Blocks `.env` / credentials; runs `npm test` if `src/` or `tests/` changed |
| **pre-push** | `git push` | Runs `npm test` + `npm run build`; blocks direct push to `main` |
| **commit-msg** | After message entered | Rejects empty messages and secret-like text |

Hooks require **Git Bash** (included with Git for Windows).
