# GitHub Actions secrets (flowdesk_ui)

Add these under **Settings → Secrets and variables → Actions** in the `flowdesk_ui` repository.
Do not commit real values to git.

Full Brightcone → FlowDesk map: **`docs/SECURITY_CI.md`**.

## FlowDesk CI secrets (used)

| Secret | Required | CI job | Purpose |
|--------|----------|--------|---------|
| `VITE_GOOGLE_CLIENT_ID` | Recommended | `build` | Google OAuth web client ID for production build. |
| `VITE_MICROSOFT_CLIENT_ID` | Optional | `build` | Microsoft SSO client ID for MSAL build. |
| `SNYK_TOKEN` | Optional | `security-scan` | Snyk dependency scan + Snyk Code SAST. Skipped if unset. |

## Brightcone `Deploy Frontend` secrets (NOT used in FlowDesk)

These belong to Brightcone `deploy-staging` (S3 + CloudFront). Do **not** add them to `flowdesk_ui`:

| Secret | Brightcone use |
|--------|----------------|
| `VITE_BACKEND_URL` | API base URL in deploy build |
| `VITE_RECRUITMENT_API_URL` | Recruitment microservice |
| `VITE_REASONING_API_URL` | Reasoning microservice |
| `VITE_TRANSIT_API_BASE_URL` | Transit microservice |
| `VITE_TARTA_API_BASE_URL` | Tarta microservice |
| `VITE_RABBIT_API_BASE_URL` | Rabbit microservice |
| `VITE_GOOGLE_MAPS_API_KEY` | Maps widget |
| `VITE_CLARITY_PROJECT_ID` | Clarity analytics |
| `VITE_CLARITY_ENABLED` | Clarity toggle |
| `VITE_BRIGHT_PROPERTY_URL` | Property service |
| `VITE_HELPDESK_API_URL` | Helpdesk (mapped to `VITE_HELPDESK_URL` in Brightcone) |
| `VITE_BRIGHT_AGENT_ROUTER_URL` | Agent router |

FlowDesk also does **not** use AWS OIDC role `brightcone-production-github-deploy` or S3 buckets `brightcone-frontend-staging` / `brightcone-frontend-production`.

E2E Playwright against `flowdesk_API` is **not** run in CI until that repo is accessible to Actions.

## Local development

Use the workspace root `.env` (see `flowdesk_ui/.env.example`). Never commit `.env`.
