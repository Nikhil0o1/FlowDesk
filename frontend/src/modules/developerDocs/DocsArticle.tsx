import { Link } from 'react-router-dom'

import type { ApiTokenMeta } from '../../lib/apiKeys'
import { API_BASE } from '../../lib/env'
import { CodeBlock } from './components/CodeBlock'
import { EXAMPLES } from './examples'
import type { DocsSlug } from './nav'

function Callout({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div
      className={
        tone === 'warn'
          ? 'rounded-lg border border-amber-600/50 bg-amber-500/15 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/40 dark:text-amber-100'
          : 'rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-fg-secondary'
      }
    >
      {children}
    </div>
  )
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-8 scroll-mt-20 text-lg font-semibold text-fg">
      {children}
    </h2>
  )
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mt-5 scroll-mt-20 text-base font-semibold text-fg">
      {children}
    </h3>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{children}</p>
}

export function DocsArticle({ slug, meta }: { slug: DocsSlug; meta: ApiTokenMeta | undefined }) {
  const base = `${API_BASE || '/api/v1'}`
  const version = meta?.api_version ?? '1.0.0'
  const routes = meta?.public_routes ?? []
  const scopes = meta?.scopes ?? []
  const rates = meta?.rate_limits ?? []
  const grace = meta?.rotation_grace_seconds ?? 300

  switch (slug) {
    case 'overview':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">FlowDesk API</h1>
          <P>
            The FlowDesk API lets integrations, CI jobs, and internal tools act on your behalf using
            OAuth Custom Apps or personal API tokens. Credentials are user-bound and limited by the
            scopes you choose plus your live FlowDesk permissions.
          </P>
          <Callout tone="warn">
            Resource-specific restrictions are not available yet. A selected scope applies to all
            matching resources you can access. Organization service accounts are not supported in this
            version.
          </Callout>
          <H2 id="who">Who should use this</H2>
          <P>
            Teams building third-party integrations (OAuth Custom Apps), and developers using personal
            tokens for scripts, CI, or MCP sidecars.
          </P>
          <H2 id="base">Base URL & version</H2>
          <P>
            API version <strong className="text-fg">{version}</strong>. Base path:{' '}
            <code className="font-mono text-xs text-fg">{base}</code>
          </P>
          <H2 id="auth-model">Authentication model</H2>
          <P>
            Settings → API Keys exposes two products:{' '}
            <strong className="text-fg">Custom Apps</strong> (OAuth{' '}
            <code className="font-mono text-xs">client_id</code> /{' '}
            <code className="font-mono text-xs">client_secret</code> for apps other people use) and{' '}
            <strong className="text-fg">Personal API tokens</strong> (
            <code className="font-mono text-xs">fd_live_…</code> for personal automation). API calls
            use <code className="font-mono text-xs">Authorization: Bearer &lt;access_token&gt;</code>.
            PAT-shaped credentials never fall back to session JWT authentication.
          </P>
          <H2 id="phase1">Phase 1 resources</H2>
          <P>
            Public API-key coverage matches the registered PAT allowlist ({routes.length || '…'}{' '}
            endpoints): profile, organizations, workspaces/projects, tasks, comments, search, and time
            tracking. MCP audit recording is available for the MCP sidecar only.
          </P>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-fg-secondary">
            <li>
              <Link className="text-brand hover:underline" to="/app/settings?tab=api-keys">
                Create an App / API token
              </Link>
            </li>
            <li>
              <Link className="text-brand hover:underline" to="/app/developers/oauth-apps">
                OAuth Apps guide
              </Link>
            </li>
            <li>
              <Link className="text-brand hover:underline" to="/app/developers/api-reference">
                API reference
              </Link>
            </li>
          </ul>
        </article>
      )

    case 'quickstart':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Quickstart</h1>
          <H2 id="oauth-app">Build an app for others (OAuth)</H2>
          <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm text-fg-secondary">
            <li>
              As an org admin, open{' '}
              <Link className="text-brand hover:underline" to="/app/settings?tab=api-keys">
                Settings → API Keys → FlowDesk API Settings
              </Link>{' '}
              and <strong className="text-fg">Create an App</strong>.
            </li>
            <li>
              Enter your application&apos;s redirect URL(s) — the HTTPS callback where FlowDesk will
              send the authorization <code className="font-mono text-xs">code</code>.
            </li>
            <li>
              Store <code className="font-mono text-xs">client_id</code> and{' '}
              <code className="font-mono text-xs">client_secret</code> in your server environment (never
              in a browser bundle or public repo).
            </li>
            <li>
              Send users through the authorize URL, exchange the{' '}
              <code className="font-mono text-xs">code</code> at the token endpoint, then call the API
              with the returned <code className="font-mono text-xs">access_token</code>.
            </li>
          </ol>
          <H2 id="personal">Personal token (scripts / MCP)</H2>
          <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm text-fg-secondary">
            <li>
              Open{' '}
              <Link className="text-brand hover:underline" to="/app/settings?tab=api-keys">
                Settings → API Keys → API tokens
              </Link>{' '}
              and generate a personal token — copy the secret once.
            </li>
            <li>Choose only the scopes you need. Write does not include read.</li>
            <li>Store the key in a secrets manager (not git, not frontend code).</li>
            <li>Call <code className="font-mono text-xs">GET /auth/me</code> to verify access.</li>
            <li>Handle non-2xx responses and rotate or revoke when needed.</li>
          </ol>
          <H2 id="first-request">First request</H2>
          <div className="mt-3 space-y-3">
            <CodeBlock label="curl" code={EXAMPLES.curlAuthMe(base)} />
            <CodeBlock label="JavaScript (Node.js)" language="javascript" code={EXAMPLES.jsAuthMe(base)} />
            <CodeBlock label="Python" language="python" code={EXAMPLES.pyAuthMe(base)} />
          </div>
          <Callout>
            Shell <code className="font-mono text-xs">export</code> /{' '}
            <code className="font-mono text-xs">$env:</code> examples are for local development only.
            Prefer a secrets manager in deployed systems. Avoid printing keys or putting them in URLs.
          </Callout>
        </article>
      )

    case 'authentication':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Authentication</h1>
          <P>
            Authenticate to the FlowDesk API with a personal token or an OAuth access token. For apps
            that other people use, implement the OAuth Authorization Code flow (
            <Link className="text-brand hover:underline" to="/app/developers/oauth-apps">
              OAuth Apps
            </Link>
            ). Personal tokens are for individual or testing use.
          </P>
          <H2 id="two-products">Two credential products</H2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-fg-secondary">
            <li>
              <strong className="text-fg">Custom Apps (OAuth)</strong> — org admins create an app and
              receive <code className="font-mono text-xs">client_id</code> /{' '}
              <code className="font-mono text-xs">client_secret</code>. Users authorize your app;
              you receive a user-bound <code className="font-mono text-xs">access_token</code>.
            </li>
            <li>
              <strong className="text-fg">Personal API tokens</strong> —{' '}
              <code className="font-mono text-xs">fd_live_…</code> keys for personal automation and
              MCP. Same storage and verification stack as OAuth access tokens.
            </li>
          </ul>
          <H2 id="bearer">Bearer authentication</H2>
          <P>
            Include the access token (from OAuth or a personal key) in the Authorization header:
          </P>
          <CodeBlock code={`Authorization: Bearer fd_live_<public_key_id>_<secret>`} label="header" />
          <H2 id="format">Key format</H2>
          <P>
            Access tokens use the <code className="font-mono text-xs">fd_live_</code> prefix with a
            public key id and secret. Digests use HMAC-SHA-256 with a versioned pepper. The full
            secret is shown once — FlowDesk cannot display it again.
          </P>
          <H2 id="identity">User-bound identity</H2>
          <P>
            Tokens act as the authorizing / creating user. They cannot outlive the user account,
            organization membership, or the user&apos;s current permissions. Effective access is the
            intersection of token scopes, route requirements, and live RBAC.
          </P>
          <H2 id="storage">Secure storage</H2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-secondary">
            <li>Never put secrets in query strings, frontend bundles, or git.</li>
            <li>
              Keep <code className="font-mono text-xs">client_id</code> /{' '}
              <code className="font-mono text-xs">client_secret</code> on your server; encrypt{' '}
              <code className="font-mono text-xs">access_token</code> at rest in your application.
            </li>
            <li>FlowDesk stores only peppered digests of secrets — never plaintext after create.</li>
          </ul>
          <H2 id="no-jwt">No JWT fallback</H2>
          <P>
            Credentials that look like API keys are verified only as API keys. They never fall through
            to session JWT validation.
          </P>
          <H2 id="usage">Usage dashboard</H2>
          <P>
            Each personal key has a support-oriented usage view (rolling 24h request/error/429 counts,
            last success/fail, optional last IP). Counters help diagnose integrations — they are not a
            billing meter.
          </P>
        </article>
      )

    case 'oauth-apps':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">OAuth Apps</h1>
          <P>
            To allow others to use your integration, implement the OAuth 2.0 Authorization Code grant
            so each user has their own token for accessing their FlowDesk resources.
          </P>
          <P>
            Grant type: <code className="font-mono text-xs">authorization_code</code>. Authorization
            URL and token URL are listed below. Personal API tokens do not use the token endpoint.
          </P>
          <H2 id="create">1. Create an OAuth app</H2>
          <P>Only organization owners or admins can create OAuth apps.</P>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-fg-secondary">
            <li>
              Open{' '}
              <Link className="text-brand hover:underline" to="/app/settings?tab=api-keys">
                Settings → API Keys → FlowDesk API Settings
              </Link>
              .
            </li>
            <li>Click <strong className="text-fg">Create an App</strong>.</li>
            <li>Name the app and add one or more redirect URLs.</li>
            <li>
              You receive a <code className="font-mono text-xs">client_id</code> and{' '}
              <code className="font-mono text-xs">client_secret</code> (secret shown once).
            </li>
          </ol>
          <H2 id="env">2. Configure your application</H2>
          <P>Store these values in your server environment:</P>
          <CodeBlock
            label="environment"
            code={[
              'FLOWDESK_CLIENT_ID=<client_id>',
              'FLOWDESK_CLIENT_SECRET=<client_secret>',
              'FLOWDESK_REDIRECT_URI=https://<your-app-host>/oauth/callback',
              'FLOWDESK_WEBHOOK_BASE_URL=https://<your-app-host>/webhooks/flowdesk',
              `FLOWDESK_DEFAULT_BASE_URL=${base}`,
            ].join('\n')}
          />
          <Callout tone="warn">
            Redirect and webhook URLs are owned by your application. FlowDesk registers redirect URLs
            on the OAuth app for exact-match validation. Webhook base URL is for your receiver — use
            FlowDesk org webhooks (or your own registration flow) and verify{' '}
            <code className="font-mono text-xs">X-FlowDesk-Signature</code>.
          </Callout>
          <H2 id="authorize">3. Retrieve an authorization code</H2>
          <P>Send users to this URL to connect their FlowDesk account:</P>
          <CodeBlock
            label="authorize"
            code={`${base}/oauth/integrations/authorize?client_id={client_id}&redirect_uri={redirect_uri}&state={state}`}
          />
          <P>
            After the user approves, FlowDesk redirects to your{' '}
            <code className="font-mono text-xs">redirect_uri</code> with{' '}
            <code className="font-mono text-xs">code</code> (and <code className="font-mono text-xs">state</code>{' '}
            if you provided one). Non-SSL redirect URIs may not be supported in production.
          </P>
          <H2 id="token">4. Request a token</H2>
          <P>
            <code className="font-mono text-xs">POST {base}/oauth/integrations/token</code> with JSON:
          </P>
          <CodeBlock
            label="JSON"
            language="json"
            code={`{\n  "client_id": "...",\n  "client_secret": "...",\n  "code": "..."\n}`}
          />
          <P>
            Response includes <code className="font-mono text-xs">access_token</code> (
            <code className="font-mono text-xs">fd_live_…</code>) bound to the authorizing user.
            Use <code className="font-mono text-xs">Authorization: Bearer {'{access_token}'}</code> for
            API requests. Effective access is{' '}
            <code className="font-mono text-xs">token.scopes ∩ route scopes ∩ PermissionService(user)</code>
            — the token cannot exceed the authorizing user&apos;s live permissions.
          </P>
          <H2 id="webhooks-note">Webhooks</H2>
          <P>
            Create webhook endpoints under Settings → Webhooks (org admin). Each endpoint has a signing
            secret. Verify deliveries with HMAC over{' '}
            <code className="font-mono text-xs">{'{timestamp}.{raw_body}'}</code> using the{' '}
            <code className="font-mono text-xs">X-FlowDesk-Signature</code> header (see Webhooks docs).
            Webhook secrets are separate from OAuth <code className="font-mono text-xs">client_secret</code>.
          </P>
        </article>
      )

    case 'scopes':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Scopes</h1>
          <Callout tone="warn">
            Scopes are not restricted to individual workspaces or projects in this version. Write does
            not imply read — select both when you need both.
          </Callout>
          <div className="mt-6 space-y-6">
            {scopes.map((s) => (
              <div key={s.scope} className="border-b border-ink-700/60 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-sm text-fg">{s.scope}</code>
                  <span className="text-sm font-medium text-fg">{s.name}</span>
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase text-fg-muted">
                    {s.access}
                  </span>
                </div>
                <P>{s.description}</P>
                <p className="mt-1 text-xs text-fg-muted">Group: {s.group}</p>
              </div>
            ))}
            {!scopes.length && <P>Loading scope catalog…</P>}
          </div>
        </article>
      )

    case 'api-reference':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">API Reference</h1>
          <P>
            Only endpoints that accept personal API keys are listed. Internal JWT-only and admin
            routes are excluded. Required scopes and rate categories come from the live allowlist.
          </P>
          <Callout>
            Download the filtered OpenAPI document from{' '}
            <code className="font-mono text-xs">GET {base}/users/me/api-tokens/public-openapi</code>{' '}
            while signed in to FlowDesk (session JWT).
          </Callout>
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink-700">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-ink-700 bg-ink-900 text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Methods</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="px-3 py-2 font-medium">Scopes</th>
                  <th className="px-3 py-2 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/60">
                {routes.map((r) => (
                  <tr key={`${r.methods.join(',')}:${r.path}`}>
                    <td className="px-3 py-2 font-mono text-fg">{r.methods.join(', ')}</td>
                    <td className="px-3 py-2 font-mono text-fg">{r.path.replace(/^\/api\/v1/, '')}</td>
                    <td className="px-3 py-2 text-fg-secondary">{r.scopes.join(', ')}</td>
                    <td className="px-3 py-2 text-fg-secondary">{r.rate_category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!routes.length && <P>Loading public routes…</P>}
        </article>
      )

    case 'errors':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Errors</h1>
          <P>Stable machine-readable errors use this shape:</P>
          <CodeBlock
            language="json"
            code={`{\n  "error": {\n    "code": "invalid_credentials",\n    "message": "Invalid authentication credentials."\n  }\n}`}
          />
          <div className="mt-4 space-y-4 text-sm text-fg-secondary">
            <div>
              <H3 id="invalid_credentials">401 invalid_credentials</H3>
              <P>
                Invalid, expired, revoked, malformed, or otherwise unusable API key. Do not attempt to
                distinguish secret-failure reasons from the response.
              </P>
            </div>
            <div>
              <H3 id="insufficient_scope">403 insufficient_scope</H3>
              <P>The key is valid but lacks a required scope for the route.</P>
            </div>
            <div>
              <H3 id="pat_not_allowed">403 pat_not_allowed</H3>
              <P>The endpoint is not available to API-key authentication.</P>
            </div>
            <div>
              <H3 id="rate_limited">429 rate_limited</H3>
              <P>Rate limit exceeded. Honor Retry-After and use exponential backoff with jitter.</P>
            </div>
            <div>
              <H3 id="service_unavailable">503 service_unavailable</H3>
              <P>
                Required rate-limit infrastructure is unavailable. Retry later; do not tight-loop.
              </P>
            </div>
            <div>
              <H3 id="app-errors">Application errors</H3>
              <P>
                Ordinary application responses may use 400 (validation), 404 (not found or
                inaccessible), 409 (conflict), or 422 (schema validation) with endpoint-specific
                bodies. Stack traces and internal class names are never part of the public contract.
              </P>
            </div>
          </div>
        </article>
      )

    case 'rate-limits':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Rate Limits</h1>
          <P>
            Limits are enforced per API key, per target organization (when resolved), and by category
            using a fixed window. Values below are loaded from the live backend configuration.
          </P>
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink-700">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-ink-700 bg-ink-900 text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Limit</th>
                  <th className="px-3 py-2">Window</th>
                  <th className="px-3 py-2">Algorithm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700/60">
                {rates.map((r) => (
                  <tr key={r.category}>
                    <td className="px-3 py-2 font-mono text-fg">{r.category}</td>
                    <td className="px-3 py-2 text-fg">{r.limit}</td>
                    <td className="px-3 py-2 text-fg">{r.window_seconds}s</td>
                    <td className="px-3 py-2 text-fg-secondary">{r.algorithm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rates.length && <P>Loading rate limits…</P>}
          <H2 id="backoff">Backoff guidance</H2>
          <CodeBlock label="JavaScript" language="javascript" code={EXAMPLES.backoffJs()} />
          <Callout tone="warn">Do not retry immediately in a tight loop after 429 or 503.</Callout>
        </article>
      )

    case 'pagination':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Pagination & Filtering</h1>
          <P>
            Documented only for endpoints that support it. Many Phase 1 list endpoints return
            membership-filtered arrays without cursor pagination — do not assume offset/cursor
            parameters unless the endpoint schema declares them.
          </P>
          <H2 id="search">Search</H2>
          <P>
            <code className="font-mono text-xs">GET /search</code> accepts{' '}
            <code className="font-mono text-xs">q</code> and{' '}
            <code className="font-mono text-xs">limit</code>. Empty results return an empty collection
            shape rather than an error.
          </P>
          <H2 id="me-tasks">My tasks</H2>
          <P>
            <code className="font-mono text-xs">GET /me/tasks</code> supports relation filters such as{' '}
            <code className="font-mono text-xs">relation=assigned</code>. Ordering is stable for a given
            request but may not expose arbitrary sort fields.
          </P>
          <H2 id="dates">Date formats</H2>
          <P>Timestamps are ISO-8601 UTC strings unless an endpoint documents otherwise.</P>
        </article>
      )

    case 'key-rotation':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Key & Secret Rotation</h1>
          <H2 id="oauth-secret">OAuth app client secret</H2>
          <P>
            In Settings → API Keys → FlowDesk API Settings, open your app and use{' '}
            <strong className="text-fg">Regenerate</strong>. Update{' '}
            <code className="font-mono text-xs">FLOWDESK_CLIENT_SECRET</code> (or your stored secret)
            in your application immediately. The previous secret stops working as soon as
            regeneration succeeds.
          </P>
          <H2 id="personal-rotate">Personal API token rotation</H2>
          <P>
            Rotating a personal key issues a new secret (shown once) while the previous key remains
            valid for a {Math.round(grace / 60)}-minute grace window ({grace} seconds), then stops
            working.
          </P>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-fg-secondary">
            <li>Scopes can be updated during rotation when explicitly supplied.</li>
            <li>Expiry carries forward (capped by maximum lifetime policy).</li>
            <li>There is no undo after rotation completes.</li>
            <li>Immediate revoke is separate from scheduled rotation grace revocation.</li>
          </ul>
          <P>
            Manage credentials in{' '}
            <Link className="text-brand hover:underline" to="/app/settings?tab=api-keys">
              Settings → API Keys
            </Link>
            .
          </P>
        </article>
      )

    case 'webhooks':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Webhooks</h1>
          <P>
            Organization webhooks push signed JSON events to your HTTPS endpoints when tasks,
            projects, comments, or sprints change. Configure them under{' '}
            <Link className="text-brand hover:underline" to="/app/settings?tab=webhooks">
              Settings → Webhooks
            </Link>{' '}
            (organization admin). Management is JWT session only — not via personal API keys.
          </P>
          <Callout>
            Webhook signing secrets use the <code className="font-mono text-xs">whsec_</code> prefix.
            Do not confuse them with <code className="font-mono text-xs">fd_live_</code> API keys.
          </Callout>

          <H2 id="headers">Delivery headers</H2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-secondary">
            <li>
              <code className="font-mono text-xs">X-FlowDesk-Event</code> — event name (e.g.{' '}
              <code className="font-mono text-xs">task.created</code>)
            </li>
            <li>
              <code className="font-mono text-xs">X-FlowDesk-Timestamp</code> — Unix seconds used in
              the signature
            </li>
            <li>
              <code className="font-mono text-xs">X-FlowDesk-Signature</code> —{' '}
              <code className="font-mono text-xs">t=&lt;ts&gt;,v1=&lt;hex&gt;</code> (may include
              multiple <code className="font-mono text-xs">v1=</code> during secret rotation grace)
            </li>
            <li>
              <code className="font-mono text-xs">X-FlowDesk-Delivery</code> — unique delivery id
            </li>
            <li>
              <code className="font-mono text-xs">X-FlowDesk-Idempotency-Key</code> — shared across
              fan-out for one business event
            </li>
          </ul>

          <H2 id="envelope">Payload envelope</H2>
          <CodeBlock
            label="JSON"
            code={`{
  "event": "task.created",
  "api_version": "2026-07-14",
  "timestamp": "2026-07-14T12:00:00+00:00",
  "idempotency_key": "<uuid>",
  "data": { /* event-specific fields */ }
}`}
          />

          <H2 id="verify">Signature verification</H2>
          <P>
            Compute HMAC-SHA256 of the UTF-8 string{' '}
            <code className="font-mono text-xs">{'{timestamp}.{rawBody}'}</code> using your webhook
            secret. Compare against each <code className="font-mono text-xs">v1=</code> value with a
            constant-time compare. Reject requests whose timestamp is outside ±300 seconds (replay
            protection).
          </P>
          <div className="mt-2 space-y-3">
            <CodeBlock label="Node.js" code={EXAMPLES.jsVerifyWebhook()} />
            <CodeBlock label="Python" code={EXAMPLES.pyVerifyWebhook()} />
          </div>

          <H2 id="retries">Retries & auto-disable</H2>
          <P>
            Transient failures (network errors, HTTP 5xx, 429) are retried up to 6 attempts with
            exponential backoff. Permanent 4xx responses fail immediately. After 10 consecutive
            failed deliveries, the endpoint is auto-disabled and org admins are notified. Private
            tasks never emit webhooks. Production URLs must be HTTPS.
          </P>
          <P>
            Need duplex / low-latency updates instead of HTTP push? See{' '}
            <Link className="text-brand hover:underline" to="/app/developers/realtime">
              Realtime (WebSockets)
            </Link>
            .
          </P>
        </article>
      )

    case 'realtime': {
      const wsBase = base.replace(/^http/, 'ws')
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Realtime (WebSockets)</h1>
          <P>
            FlowDesk WebSockets provide duplex, low-latency updates. Use them for live UIs and
            external SaaS integrations (e.g. BrightWorks). Prefer{' '}
            <Link className="text-brand hover:underline" to="/app/developers/webhooks">
              webhooks
            </Link>{' '}
            for fire-and-forget server-to-server HTTP delivery.
          </P>

          <H2 id="app-path">In-app (browser)</H2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg-secondary">
            <li>
              Session JWT → <code className="font-mono text-xs">POST /api/v1/ws/ticket</code>
            </li>
            <li>
              Connect <code className="font-mono text-xs">/api/v1/ws?ticket=…</code> (never put the
              JWT in the URL)
            </li>
            <li>Production requires an allowlisted browser Origin</li>
          </ol>
          <Callout>
            Personal API keys cannot mint WebSocket tickets. The app path is session-only.
          </Callout>

          <H2 id="integration-path">Integration (external SaaS)</H2>
          <P>
            Create an API key with scope <code className="font-mono text-xs">realtime:read</code>,
            then connect to <code className="font-mono text-xs">/api/v1/integrations/ws</code> with{' '}
            <code className="font-mono text-xs">Authorization: Bearer fd_live_…</code> (or send{' '}
            <code className="font-mono text-xs">{`{"type":"auth","token":"…"}`}</code> as the first
            message). Metadata: <code className="font-mono text-xs">GET /integrations/realtime</code>.
          </P>
          <div className="mt-2 space-y-3">
            <CodeBlock label="Node.js" code={EXAMPLES.jsIntegrationWs(wsBase)} />
            <CodeBlock label="Python" code={EXAMPLES.pyIntegrationWs(wsBase)} />
          </div>

          <H2 id="protocol">Protocol</H2>
          <P>
            Server→client: <code className="font-mono text-xs">{'{ "type", "payload", ...ids }'}</code>.
            Client→server: <code className="font-mono text-xs">ping</code>,{' '}
            <code className="font-mono text-xs">subscribe</code> /{' '}
            <code className="font-mono text-xs">unsubscribe</code> with{' '}
            <code className="font-mono text-xs">resource</code> (
            <code className="font-mono text-xs">workspace|project|channel|whiteboard</code>) and{' '}
            <code className="font-mono text-xs">id</code>. Rooms are permission-checked. Send{' '}
            <code className="font-mono text-xs">ping</code> at least every ~30s (idle timeout ~90s).
          </P>
          <Callout tone="warn">
            Events respect the same visibility as the token owner (including private-task filters on
            emitters). Connection caps and rate limits apply per user / API key.
          </Callout>
        </article>
      )
    }

    case 'examples':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Code Examples</h1>
          <Callout tone="warn">
            Examples are server-side. Never paste production API keys into browser “try it” tools.
          </Callout>
          <H2 id="me">Get current user</H2>
          <div className="mt-2 space-y-3">
            <CodeBlock label="curl" code={EXAMPLES.curlAuthMe(base)} />
            <CodeBlock label="JavaScript" code={EXAMPLES.jsAuthMe(base)} />
            <CodeBlock label="Python" code={EXAMPLES.pyAuthMe(base)} />
          </div>
          <H2 id="orgs">List organizations</H2>
          <div className="mt-2 space-y-3">
            <CodeBlock label="curl" code={EXAMPLES.curlListOrgs(base)} />
            <CodeBlock label="JavaScript" code={EXAMPLES.jsListOrgs(base)} />
            <CodeBlock label="Python" code={EXAMPLES.pyListOrgs(base)} />
          </div>
          <H2 id="projects">List projects</H2>
          <CodeBlock label="curl" code={EXAMPLES.curlListProjects(base)} />
          <H2 id="tasks">List & create tasks</H2>
          <div className="mt-2 space-y-3">
            <CodeBlock label="curl list" code={EXAMPLES.curlListTasks(base)} />
            <CodeBlock label="curl create" code={EXAMPLES.curlCreateTask(base)} />
          </div>
          <H2 id="comments">Comments</H2>
          <div className="mt-2 space-y-3">
            <CodeBlock label="curl list" code={EXAMPLES.curlListComments(base)} />
            <CodeBlock label="curl create" code={EXAMPLES.curlAddComment(base)} />
          </div>
          <H2 id="search">Search</H2>
          <CodeBlock label="curl" code={EXAMPLES.curlSearch(base)} />
          <H2 id="time">Time tracking</H2>
          <div className="mt-2 space-y-3">
            <CodeBlock label="curl log" code={EXAMPLES.curlLogTime(base)} />
            <CodeBlock label="curl timer" code={EXAMPLES.curlTimer(base)} />
          </div>
        </article>
      )

    case 'versioning':
      return (
        <article>
          <h1 className="text-2xl font-bold text-fg">Versioning & change policy</h1>
          <P>
            Current public API version: <strong className="text-fg">{version}</strong> under{' '}
            <code className="font-mono text-xs">/api/v1</code>.
          </P>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-fg-secondary">
            <li>Breaking changes are introduced under a new version path when required.</li>
            <li>Deprecated endpoints receive notice in-product and in this changelog section before sunset.</li>
            <li>Scope additions are additive; removing a scope is a breaking change.</li>
            <li>Undocumented internal endpoints are unsupported for API-key clients.</li>
            <li>The PAT allowlist is the source of truth for public API-key routes.</li>
          </ul>
          <H2 id="changelog">Changelog</H2>
          <P>
            Phase 1: personal API keys with operation-level scopes, rotation grace, and filtered public
            reference. Workspace/project key restrictions and organization service accounts are not
            available.
          </P>
        </article>
      )

    default:
      return <P>Unknown documentation page.</P>
  }
}
