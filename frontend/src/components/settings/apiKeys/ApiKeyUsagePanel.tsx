import { useQuery } from '@tanstack/react-query'

import { api, errorMessage } from '../../../lib/api'
import {
  type ApiToken,
  type ApiTokenUsage,
  shortRoute,
  usageHealthLabel,
} from '../../../lib/apiKeys'
import { cn, formatDateTime } from '../../../lib/utils'

function healthClasses(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'degraded':
      return 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
    case 'failing':
      return 'bg-red-500/15 text-red-300'
    case 'idle':
      return 'bg-ink-700 text-fg-muted'
    case 'revoked':
    case 'expired':
      return 'bg-ink-700 text-fg-muted'
    default:
      return 'bg-ink-700 text-fg-secondary'
  }
}

function activityLabel(event: string): string {
  switch (event) {
    case 'created':
      return 'Created'
    case 'copied':
      return 'Copied'
    case 'used':
      return 'Used'
    case 'failed':
      return 'Failed'
    case 'rate_limited':
      return 'Rate limited'
    case 'rotated':
      return 'Rotated'
    case 'revoked':
      return 'Revoked'
    default:
      return event
  }
}

function dayGroupLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yday = new Date()
  yday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function ApiKeyUsagePanel({ token }: { token: ApiToken }) {
  const usageQuery = useQuery({
    queryKey: ['api-token-usage', token.id],
    queryFn: () => api.get<ApiTokenUsage>(`/users/me/api-tokens/${token.id}/usage`),
    retry: false,
  })

  if (usageQuery.isLoading) {
    return (
      <div className="mt-4 space-y-2 border-t border-ink-700 pt-4">
        <div className="h-4 w-32 animate-pulse rounded bg-ink-800" />
        <div className="h-20 animate-pulse rounded-lg bg-ink-800" />
      </div>
    )
  }

  if (usageQuery.isError) {
    return (
      <div className="mt-4 border-t border-ink-700 pt-4 text-sm text-fg-secondary">
        Could not load usage: {errorMessage(usageQuery.error)}
        <button type="button" className="btn-secondary ml-2" onClick={() => usageQuery.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  const usage = usageQuery.data!
  const groups = new Map<string, typeof usage.activity>()
  for (const row of usage.activity) {
    const label = dayGroupLabel(row.at)
    const list = groups.get(label) ?? []
    list.push(row)
    groups.set(label, list)
  }

  return (
    <div className="mt-4 space-y-4 border-t border-ink-700 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Usage (24h)</h3>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', healthClasses(usage.status))}>
          {usageHealthLabel(usage.status)}
        </span>
      </div>

      {!usage.metrics_available ? (
        <p className="rounded-lg border border-amber-600/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:text-amber-100">
          Usage metrics require Redis. Request counts are unavailable in this environment — lifecycle
          events below may still appear.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Requests (24h)" value={String(usage.requests_24h)} />
          <Stat label="Errors" value={String(usage.errors_24h)} />
          <Stat label="429" value={String(usage.rate_limited_24h)} />
          <Stat label="Top endpoint" value={shortRoute(usage.top_endpoint)} mono />
        </div>
      )}

      <dl className="space-y-2 text-sm">
        <Row label="Last used" value={usage.last_used_at ? formatDateTime(usage.last_used_at) : 'Never used'} />
        <Row
          label="Last successful request"
          value={
            usage.last_success_at
              ? `${formatDateTime(usage.last_success_at)} · ${shortRoute(usage.last_success_route)}`
              : '—'
          }
        />
        <Row
          label="Last failed request"
          value={
            usage.last_fail_at
              ? `${formatDateTime(usage.last_fail_at)} · ${usage.last_fail_status ?? ''} ${shortRoute(usage.last_fail_route)}`
              : '—'
          }
        />
        {usage.last_ip ? <Row label="Last IP" value={usage.last_ip} /> : null}
      </dl>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Activity</h4>
        {usage.activity.length === 0 ? (
          <p className="mt-2 text-xs text-fg-muted">No activity recorded yet.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {[...groups.entries()].map(([day, rows]) => (
              <div key={day}>
                <p className="text-xs font-medium text-fg-secondary">{day}</p>
                <ul className="mt-1 space-y-1.5 border-l border-ink-700 pl-3">
                  {rows.map((row, idx) => (
                    <li key={`${row.at}-${row.event}-${idx}`} className="text-xs text-fg-secondary">
                      <span className="font-mono text-fg-muted">{timeOf(row.at)}</span>{' '}
                      <span className="font-medium text-fg">{activityLabel(row.event)}</span>
                      {row.detail ? <span className="text-fg-muted"> — {row.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-fg-muted">
        Counters are a rolling 24-hour window for support diagnosis — not a billing meter. Last IP may
        be a proxy or edge address.
      </p>
    </div>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/50 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</p>
      <p className={cn('mt-0.5 truncate text-sm font-semibold text-fg', mono && 'font-mono text-xs')}>
        {value}
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  )
}
