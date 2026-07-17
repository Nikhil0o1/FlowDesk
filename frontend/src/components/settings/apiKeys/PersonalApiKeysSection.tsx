import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { api, ApiError, errorMessage } from '../../../lib/api'
import {
  type ApiKeyStatus,
  type ApiToken,
  type ApiTokenCreated,
  type ApiTokenMeta,
  type EphemeralSecret,
  apiKeyStatusLabel,
  deriveApiKeyStatus,
  maskApiKeyId,
} from '../../../lib/apiKeys'
import { useAuthStore } from '../../../stores/auth'
import { cn, formatDateTime } from '../../../lib/utils'
import { toast } from '../../../stores/toast'
import { EmptyState } from '../../ui/EmptyState'
import { Modal } from '../../ui/Modal'
import { ApiKeyUsagePanel } from './ApiKeyUsagePanel'
import { SecretRevealDialog } from './SecretRevealDialog'

const EXPIRY_PRESETS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '180 days' },
] as const

function statusClasses(status: ApiKeyStatus): string {
  switch (status) {
    case 'active':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'expiring_soon':
      return 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
    case 'expired':
      return 'bg-ink-700 text-fg-muted'
    case 'revocation_scheduled':
      return 'bg-orange-500/15 text-orange-200'
    case 'revoked':
      return 'bg-red-500/15 text-red-300'
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never used'
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return formatDateTime(iso)
}

export function PersonalApiKeysSection() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'created' | 'expiry' | 'last_used'>('created')
  const [createOpen, setCreateOpen] = useState(false)
  const [rotateTarget, setRotateTarget] = useState<ApiToken | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null)
  const [detailTarget, setDetailTarget] = useState<ApiToken | null>(null)
  const [ephemeral, setEphemeral] = useState<EphemeralSecret | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  const metaQuery = useQuery({
    queryKey: ['api-token-meta'],
    queryFn: () => api.get<ApiTokenMeta>('/users/me/api-tokens/meta'),
    retry: false,
  })

  const listQuery = useQuery({
    queryKey: ['api-tokens', 'include-revoked'],
    queryFn: () => api.get<ApiToken[]>('/users/me/api-tokens?include_revoked=true'),
    retry: false,
  })

  const permissionDenied =
    (metaQuery.error instanceof ApiError && (metaQuery.error.status === 401 || metaQuery.error.status === 403)) ||
    (listQuery.error instanceof ApiError && (listQuery.error.status === 401 || listQuery.error.status === 403))

  const tokens = listQuery.data ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = tokens
    if (q) rows = rows.filter((t) => t.name.toLowerCase().includes(q))
    rows = [...rows].sort((a, b) => {
      const av =
        sort === 'created'
          ? a.created_at
          : sort === 'expiry'
            ? a.expires_at || ''
            : a.last_used_at || ''
      const bv =
        sort === 'created'
          ? b.created_at
          : sort === 'expiry'
            ? b.expires_at || ''
            : b.last_used_at || ''
      return bv.localeCompare(av)
    })
    return rows
  }, [tokens, search, sort])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
  }

  if (permissionDenied) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 px-6 py-12 text-center">
        <AlertTriangle className="mx-auto text-amber-400" size={28} />
        <h2 className="mt-3 text-base font-semibold text-fg">Permission required</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          You do not have access to manage personal API keys. Sign in again or contact an administrator.
        </p>
      </div>
    )
  }

  if (listQuery.isLoading || metaQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded bg-ink-800" />
        <div className="h-24 animate-pulse rounded-xl bg-ink-800" />
        <div className="h-24 animate-pulse rounded-xl bg-ink-800" />
      </div>
    )
  }

  if (listQuery.isError || metaQuery.isError) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 px-6 py-10 text-center">
        <p className="text-sm text-fg-secondary">
          {errorMessage(listQuery.error || metaQuery.error)}
        </p>
        <button type="button" className="btn-secondary mt-4" onClick={() => { listQuery.refetch(); metaQuery.refetch() }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg">Personal API tokens</h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
            For personal scripts, testing, and MCP. Not recommended for multi-user integrations —
            use Custom Apps (OAuth) instead. Tokens are user-bound and limited by the scopes you
            choose.
          </p>
          <p className="mt-2 text-sm">
            <a href="/app/developers/authentication" className="text-brand hover:underline">
              Personal token vs OAuth apps
            </a>
          </p>
        </div>
        <button type="button" className="btn-primary shrink-0 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          Create API key
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            className="input-dark w-full pl-9"
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search API keys by name"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          Sort
          <select
            className="input-dark"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label="Sort API keys"
          >
            <option value="created">Created</option>
            <option value="expiry">Expiry</option>
            <option value="last_used">Last used</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={search ? 'No matching keys' : 'No API keys yet'}
          description={
            search
              ? 'Try a different name.'
              : 'Create a personal API key to connect CI, reporting, or automation tools.'
          }
          action={
            !search ? (
              <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                Create API key
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <div className="hidden grid-cols-[1.4fr_1fr_0.8fr_1fr_1fr_auto] gap-2 border-b border-ink-700 bg-ink-900/80 px-4 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted md:grid">
            <span>Name</span>
            <span>Identifier</span>
            <span>Status</span>
            <span>Expiry</span>
            <span>Last used</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y divide-ink-700/60">
            {filtered.map((token) => {
              const status = deriveApiKeyStatus(token)
              return (
                <li key={token.id} className="bg-ink-900 px-4 py-3">
                  <div className="flex flex-col gap-2 md:grid md:grid-cols-[1.4fr_1fr_0.8fr_1fr_1fr_auto] md:items-center md:gap-2">
                    <div>
                      <button
                        type="button"
                        className="text-left text-sm font-medium text-fg hover:underline"
                        onClick={() => setDetailTarget(token)}
                      >
                        {token.name}
                      </button>
                      <p className="mt-0.5 text-xs text-fg-muted" title={token.scopes.join(', ')}>
                        {token.scopes.length === 0
                          ? 'No scopes'
                          : token.scopes.length <= 3
                            ? token.scopes.join(', ')
                            : `${token.scopes.slice(0, 3).join(', ')} +${token.scopes.length - 3}`}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted md:hidden">
                        Created {formatDateTime(token.created_at)}
                        {user ? ` · ${user.email}` : ''}
                      </p>
                    </div>
                    <code className="font-mono text-xs text-fg-secondary">{maskApiKeyId(token)}</code>
                    <span
                      className={cn(
                        'inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium',
                        statusClasses(status),
                      )}
                    >
                      {apiKeyStatusLabel(status)}
                    </span>
                    <span className="text-xs text-fg-secondary">
                      {token.expires_at ? formatDateTime(token.expires_at) : 'No expiry'}
                    </span>
                    <span className="text-xs text-fg-secondary" title={token.last_used_at ? formatDateTime(token.last_used_at) : undefined}>
                      {relativeTime(token.last_used_at)}
                    </span>
                    <div className="relative justify-self-end">
                      <button
                        type="button"
                        className="btn-ghost p-2"
                        aria-label={`Actions for ${token.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuId === token.id}
                        onClick={() => setMenuId(menuId === token.id ? null : token.id)}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menuId === token.id && (
                        <div
                          role="menu"
                          className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-popover"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-ink-800"
                            onClick={() => {
                              setDetailTarget(token)
                              setMenuId(null)
                            }}
                          >
                            View details
                          </button>
                          {status !== 'revoked' && (
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-ink-800"
                              onClick={() => {
                                setRotateTarget(token)
                                setMenuId(null)
                              }}
                            >
                              Rotate
                            </button>
                          )}
                          {status !== 'revoked' && (
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full px-3 py-1.5 text-left text-sm text-red-300 hover:bg-ink-800"
                              onClick={() => {
                                setRevokeTarget(token)
                                setMenuId(null)
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {createOpen && metaQuery.data && (
        <CreateKeyDialog
          meta={metaQuery.data}
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false)
            setEphemeral({ raw: created.token, keyName: created.name, reason: 'created', tokenId: created.id })
            refresh()
          }}
        />
      )}

      {rotateTarget && metaQuery.data && (
        <RotateKeyDialog
          token={rotateTarget}
          meta={metaQuery.data}
          onClose={() => setRotateTarget(null)}
          onRotated={(created, oldToken) => {
            setRotateTarget(null)
            setEphemeral({ raw: created.token, keyName: created.name, reason: 'rotated', tokenId: created.id })
            refresh()
            void oldToken
          }}
        />
      )}

      {revokeTarget && (
        <RevokeKeyDialog
          token={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => {
            setRevokeTarget(null)
            refresh()
          }}
        />
      )}

      {detailTarget && (
        <KeyDetailsModal
          token={detailTarget}
          createdBy={user?.email ?? 'You'}
          onClose={() => setDetailTarget(null)}
          onRenamed={(updated) => {
            setDetailTarget(updated)
            refresh()
          }}
        />
      )}

      {ephemeral && (
        <SecretRevealDialog
          secret={ephemeral}
          onAcknowledgedClose={() => setEphemeral(null)}
        />
      )}
    </div>
  )
}

function CreateKeyDialog({
  meta,
  onClose,
  onCreated,
}: {
  meta: ApiTokenMeta
  onClose: () => void
  onCreated: (created: ApiTokenCreated) => void
}) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [expiryMode, setExpiryMode] = useState<'7' | '30' | '90' | '180' | 'none' | 'custom'>('90')
  const [customDays, setCustomDays] = useState(60)
  const [submitting, setSubmitting] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const groups = useMemo(() => {
    const map = new Map<string, typeof meta.scopes>()
    for (const s of meta.scopes) {
      const list = map.get(s.group) ?? []
      list.push(s)
      map.set(s.group, list)
    }
    return [...map.entries()]
  }, [meta.scopes])

  const expiresInDays = (): number | null => {
    if (expiryMode === 'none') return null
    if (expiryMode === 'custom') return customDays
    return Number(expiryMode)
  }

  const toggleScope = (scope: string) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Name is required')
      return
    }
    if (trimmed.length > 120) {
      setNameError('Name must be at most 120 characters')
      return
    }
    const days = expiresInDays()
    if (days !== null && (days < 1 || days > meta.max_lifetime_days)) {
      toast.error(`Expiry must be between 1 and ${meta.max_lifetime_days} days`)
      return
    }
    setSubmitting(true)
    try {
      const created = await api.post<ApiTokenCreated>('/users/me/api-tokens', {
        name: trimmed,
        scopes,
        expires_in_days: days,
      })
      // Do not toast the raw key
      toast.success('API key created — copy it now')
      onCreated(created)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open title="Create API key" onClose={onClose} width="max-w-2xl">
      <div className="space-y-5">
        <div>
          <label className="text-sm font-medium text-fg" htmlFor="api-key-name">
            Key name
          </label>
          <input
            id="api-key-name"
            className="input-dark mt-1 w-full"
            placeholder="e.g. Reporting integration"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
            }}
            maxLength={120}
            autoFocus
          />
          {nameError && (
            <p className="mt-1 text-xs text-red-400" role="alert">
              {nameError}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-fg">Scopes</h3>
            <span className="text-xs text-fg-muted">Default: none selected</span>
          </div>
          <p className="mt-1 text-xs text-fg-secondary">
            Write does not include read. Select both when you need both.
          </p>
          <div className="mt-3 max-h-64 space-y-4 overflow-y-auto rounded-lg border border-ink-700 p-3">
            {groups.map(([group, items]) => (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{group}</p>
                <ul className="mt-2 space-y-2">
                  {items.map((item) => (
                    <li key={item.scope}>
                      <label className="flex cursor-pointer gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={scopes.includes(item.scope)}
                          onChange={() => toggleScope(item.scope)}
                        />
                        <span>
                          <span className="font-medium text-fg">{item.name}</span>
                          <code className="ml-2 font-mono text-xs text-fg-muted">{item.scope}</code>
                          {item.access === 'write' && (
                            <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase text-amber-900 dark:text-amber-200">
                              write
                            </span>
                          )}
                          <span className="mt-0.5 block text-xs text-fg-secondary">{item.description}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-fg">Expiry</h3>
          <p className="mt-1 text-xs text-fg-secondary">
            Prefer shorter lifetimes. Maximum {meta.max_lifetime_days} days.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXPIRY_PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm',
                  expiryMode === String(p.days)
                    ? 'border-brand bg-brand/10 text-fg'
                    : 'border-ink-700 text-fg-secondary hover:border-ink-600',
                )}
                onClick={() => setExpiryMode(String(p.days) as typeof expiryMode)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm',
                expiryMode === 'custom'
                  ? 'border-brand bg-brand/10 text-fg'
                  : 'border-ink-700 text-fg-secondary hover:border-ink-600',
              )}
              onClick={() => setExpiryMode('custom')}
            >
              Custom days
            </button>
            <button
              type="button"
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm',
                expiryMode === 'none'
                  ? 'border-brand bg-brand/10 text-fg'
                  : 'border-ink-700 text-fg-secondary hover:border-ink-600',
              )}
              onClick={() => setExpiryMode('none')}
            >
              No expiry
            </button>
          </div>
          {expiryMode === 'custom' && (
            <input
              type="number"
              min={1}
              max={meta.max_lifetime_days}
              className="input-dark mt-2 w-32"
              value={customDays}
              onChange={(e) => setCustomDays(Number(e.target.value))}
              aria-label="Custom expiry in days"
            />
          )}
        </div>

        <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-sm">
          <h4 className="font-medium text-fg">Review</h4>
          <ul className="mt-2 space-y-1 text-fg-secondary">
            <li>Name: {name.trim() || '—'}</li>
            <li>
              Scopes: {scopes.length === 0 ? 'None' : scopes.join(', ')}
            </li>
            <li>
              Expiry:{' '}
              {expiresInDays() === null ? 'No expiry' : `${expiresInDays()} days`}
            </li>
            <li>
              Identity: user-bound — acts with your current FlowDesk access.
            </li>
          </ul>
          <p className="mt-3 text-xs text-amber-900 dark:text-amber-200/90">
            This key acts with your current FlowDesk access. It can access all matching resources you
            are already permitted to access. Workspace- and project-specific restrictions are not
            available in this version.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" /> Creating…
              </span>
            ) : (
              'Create key'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function RotateKeyDialog({
  token,
  meta,
  onClose,
  onRotated,
}: {
  token: ApiToken
  meta: ApiTokenMeta
  onClose: () => void
  onRotated: (created: ApiTokenCreated, old: ApiToken) => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scopes, setScopes] = useState<string[]>(() => [...token.scopes])
  const [changeScopes, setChangeScopes] = useState(false)
  const graceMin = Math.round(meta.rotation_grace_seconds / 60)

  const groups = useMemo(() => {
    const map = new Map<string, typeof meta.scopes>()
    for (const s of meta.scopes) {
      const list = map.get(s.group) ?? []
      list.push(s)
      map.set(s.group, list)
    }
    return [...map.entries()]
  }, [meta.scopes])

  const toggleScope = (scope: string) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))
  }

  const submit = async () => {
    if (!confirmed || submitting) return
    setSubmitting(true)
    try {
      const body = changeScopes ? { scopes } : {}
      const created = await api.post<ApiTokenCreated>(`/users/me/api-tokens/${token.id}/rotate`, body)
      toast.success('Key rotated — copy the new key now')
      onRotated(created, token)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open title="Rotate API key" onClose={onClose} width="max-w-lg">
      <div className="space-y-4 text-sm text-fg-secondary">
        <p>
          A new key will be generated for <span className="font-medium text-fg">{token.name}</span>.
          The new secret is shown once. The old key remains valid for about {graceMin} minutes
          ({meta.rotation_grace_seconds} seconds), then stops working.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Scopes: {changeScopes ? (scopes.length ? scopes.join(', ') : 'none') : (token.scopes.length ? token.scopes.join(', ') : 'none')}
            {!changeScopes ? ' (carry over)' : ' (updated)'}
          </li>
          <li>
            Expiry carries over:{' '}
            {token.expires_at ? formatDateTime(token.expires_at) : 'No expiry (capped at max lifetime on rotate)'}
          </li>
        </ul>
        <label className="flex items-start gap-2 text-fg">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={changeScopes}
            onChange={(e) => {
              setChangeScopes(e.target.checked)
              if (!e.target.checked) setScopes([...token.scopes])
            }}
          />
          <span>Change scopes on the new key</span>
        </label>
        {changeScopes && (
          <div className="max-h-48 space-y-3 overflow-y-auto rounded-lg border border-ink-700 p-3">
            <p className="text-xs text-fg-muted">Write does not include read. Select both when you need both.</p>
            {groups.map(([group, items]) => (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{group}</p>
                <ul className="mt-1 space-y-1">
                  {items.map((item) => (
                    <li key={item.scope}>
                      <label className="flex cursor-pointer gap-2 text-sm text-fg">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={scopes.includes(item.scope)}
                          onChange={() => toggleScope(item.scope)}
                        />
                        <span>
                          {item.name}{' '}
                          <code className="font-mono text-xs text-fg-muted">{item.scope}</code>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {!changeScopes && (
          <p className="text-xs text-fg-muted">
            To change scopes, enable the option above. In-place secret editing is not supported.
          </p>
        )}
        <label className="flex items-start gap-2 text-fg">
          <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I understand the old key will stop working after the grace period</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5"
            disabled={!confirmed || submitting}
            onClick={submit}
          >
            <RotateCcw size={14} />
            {submitting ? 'Rotating…' : 'Rotate key'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function RevokeKeyDialog({
  token,
  onClose,
  onRevoked,
}: {
  token: ApiToken
  onClose: () => void
  onRevoked: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!confirmed || submitting) return
    setSubmitting(true)
    try {
      await api.delete(`/users/me/api-tokens/${token.id}`)
      toast.success('API key revoked')
      onRevoked()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open title="Revoke API key" onClose={onClose} width="max-w-md">
      <div className="space-y-4 text-sm">
        <p className="text-fg-secondary">
          Revoking <span className="font-medium text-fg">{token.name}</span>{' '}
          (<code className="text-xs">{maskApiKeyId(token)}</code>) takes effect immediately.
          Integrations using this key will fail.
        </p>
        <label className="flex items-start gap-2 text-fg">
          <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I understand this cannot be undone</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            disabled={!confirmed || submitting}
            onClick={submit}
          >
            <Trash2 size={14} />
            {submitting ? 'Revoking…' : 'Revoke key'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function KeyDetailsModal({
  token,
  createdBy,
  onClose,
  onRenamed,
}: {
  token: ApiToken
  createdBy: string
  onClose: () => void
  onRenamed: (updated: ApiToken) => void
}) {
  const status = deriveApiKeyStatus(token)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(token.name)
  const [saving, setSaving] = useState(false)

  const saveName = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === token.name) {
      setEditing(false)
      setName(token.name)
      return
    }
    setSaving(true)
    try {
      const updated = await api.patch<ApiToken>(`/users/me/api-tokens/${token.id}`, { name: trimmed })
      toast.success('API key renamed')
      onRenamed(updated)
      setEditing(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title="API key details" onClose={onClose} width="max-w-lg">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-fg-muted">Name</dt>
          <dd className="text-fg">
            {editing && status !== 'revoked' ? (
              <div className="mt-1 flex gap-2">
                <input
                  className="input-dark flex-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  aria-label="API key name"
                />
                <button type="button" className="btn-primary" disabled={saving} onClick={saveName}>
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span>{token.name}</span>
                {status !== 'revoked' && (
                  <button type="button" className="text-xs text-brand hover:underline" onClick={() => setEditing(true)}>
                    Rename
                  </button>
                )}
              </div>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Identifier</dt>
          <dd className="font-mono text-xs text-fg">{maskApiKeyId(token)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Key status</dt>
          <dd>
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClasses(status))}>
              {apiKeyStatusLabel(status)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Scopes</dt>
          <dd className="text-fg">{token.scopes.length ? token.scopes.join(', ') : 'None'}</dd>
          <p className="mt-1 text-xs text-fg-muted">
            To change scopes, rotate the key and select a new scope set.
          </p>
        </div>
        <div>
          <dt className="text-fg-muted">Created by</dt>
          <dd className="text-fg">{createdBy}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Created</dt>
          <dd className="text-fg">{formatDateTime(token.created_at)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Expiry</dt>
          <dd className="text-fg">{token.expires_at ? formatDateTime(token.expires_at) : 'No expiry'}</dd>
        </div>
        {token.revoke_at && !token.revoked_at && (
          <div>
            <dt className="text-fg-muted">Scheduled revocation</dt>
            <dd className="text-fg">{formatDateTime(token.revoke_at)}</dd>
          </div>
        )}
        {token.environment && (
          <div>
            <dt className="text-fg-muted">Environment</dt>
            <dd className="text-fg">{token.environment}</dd>
          </div>
        )}
        <p className="rounded-lg border border-ink-700 bg-ink-900/50 p-2 text-xs text-fg-secondary">
          This key is user-bound and limited by scopes plus your live FlowDesk permissions. The full
          secret is never stored for re-display.
        </p>
      </dl>
      <ApiKeyUsagePanel token={token} />
    </Modal>
  )
}
