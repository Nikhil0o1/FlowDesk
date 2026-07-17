import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  Info,
  Plus,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, ApiError, errorMessage } from '../../lib/api'
import {
  type ApiToken,
  type ApiTokenCreated,
  type EphemeralSecret,
  deriveApiKeyStatus,
  maskApiKeyId,
} from '../../lib/apiKeys'
import {
  type AuthorizedOAuthApp,
  type EphemeralOAuthSecret,
  type OAuthApp,
  type OAuthAppCreated,
  maskSecretDots,
} from '../../lib/oauthApps'
import { useCurrentContext } from '../../lib/queries'
import type { Workspace } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'
import { SecretRevealDialog } from './apiKeys/SecretRevealDialog'
import { OAuthSecretRevealDialog } from './oauthApps/OAuthSecretRevealDialog'

type ApiSubTab = 'tokens' | 'settings'

function isOrgAdmin(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/**
 * Settings → API Keys — ClickUp-parity:
 * Tab 1: personal token + connected Custom Apps (unauthorize on hover X)
 * Tab 2: FlowDesk API Settings — create/manage apps (toggle off → delete)
 */
export function ApiKeysTab() {
  const [subTab, setSubTab] = useState<ApiSubTab>('tokens')
  const [ephemeralPat, setEphemeralPat] = useState<EphemeralSecret | null>(null)
  const [ephemeralOAuth, setEphemeralOAuth] = useState<EphemeralOAuthSecret | null>(null)

  return (
    <div className="w-full">
      <div className="flex gap-6 border-b border-ink-700">
        <SubTab active={subTab === 'tokens'} onClick={() => setSubTab('tokens')}>
          API tokens
        </SubTab>
        <SubTab active={subTab === 'settings'} onClick={() => setSubTab('settings')}>
          FlowDesk API Settings
        </SubTab>
      </div>

      <div className="pt-8">
        {subTab === 'tokens' && <ApiTokensPane onPatSecret={setEphemeralPat} />}
        {subTab === 'settings' && <ApiSettingsPane onOAuthSecret={setEphemeralOAuth} />}
      </div>

      {ephemeralPat && (
        <SecretRevealDialog
          secret={ephemeralPat}
          docsHref="/app/developers/authentication"
          onAcknowledgedClose={() => setEphemeralPat(null)}
        />
      )}
      {ephemeralOAuth && (
        <OAuthSecretRevealDialog secret={ephemeralOAuth} onClose={() => setEphemeralOAuth(null)} />
      )}
    </div>
  )
}

function SubTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors',
        active
          ? 'border-fg text-fg'
          : 'border-transparent text-fg-muted hover:text-fg-secondary',
      )}
    >
      {children}
    </button>
  )
}

/* ───────────────────────── Tab 1: API tokens ───────────────────────── */

function ApiTokensPane({ onPatSecret }: { onPatSecret: (s: EphemeralSecret) => void }) {
  return (
    <div className="space-y-10">
      <PersonalTokenBlock onPatSecret={onPatSecret} />
      <ConnectedCustomApps />
    </div>
  )
}

function PersonalTokenBlock({ onPatSecret }: { onPatSecret: (s: EphemeralSecret) => void }) {
  const queryClient = useQueryClient()
  const [confirmRegen, setConfirmRegen] = useState(false)

  const listQuery = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.get<ApiToken[]>('/users/me/api-tokens'),
    retry: false,
  })

  const activeTokens = useMemo(() => {
    const rows = listQuery.data ?? []
    return rows.filter((t) => {
      const status = deriveApiKeyStatus(t)
      return status === 'active' || status === 'expiring_soon'
    })
  }, [listQuery.data])

  const primary = activeTokens[0] ?? null
  const displayValue = primary ? maskApiKeyId(primary) : 'No personal API token yet'

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<ApiTokenCreated>('/users/me/api-tokens', {
        name: 'Personal API token',
        scopes: [
          'profile:read',
          'organizations:read',
          'projects:read',
          'tasks:read',
          'tasks:write',
          'comments:read',
          'comments:write',
          'search:read',
          'time:read',
          'time:write',
        ],
        expires_in_days: 90,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      onPatSecret({
        raw: data.token,
        tokenId: data.id,
        keyName: data.name || 'Personal API token',
        reason: 'created',
      })
      toast.success('API token created — copy it now')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const rotateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<ApiTokenCreated>(`/users/me/api-tokens/${id}/rotate`, {}),
    onSuccess: (data) => {
      setConfirmRegen(false)
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      onPatSecret({
        raw: data.token,
        tokenId: data.id,
        keyName: data.name || 'Personal API token',
        reason: 'rotated',
      })
      toast.success('API token regenerated — copy it now')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (listQuery.error instanceof ApiError && (listQuery.error.status === 401 || listQuery.error.status === 403)) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-900/40 px-4 py-8 text-center text-sm text-fg-secondary">
        You do not have access to manage personal API tokens.
      </div>
    )
  }

  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-tight text-fg">API Token</h2>
      <p className="mt-2 text-sm text-fg-secondary">
        Use a personal token for scripts, local testing, and MCP. For apps that other people use,
        create a Custom App under FlowDesk API Settings.
      </p>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="flex min-h-[42px] flex-1 items-center rounded-md border border-ink-700 bg-ink-800 px-3 font-mono text-sm text-fg">
          {listQuery.isLoading ? (
            <span className="text-fg-muted">Loading…</span>
          ) : (
            <span className="truncate">{displayValue}</span>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="inline-flex h-[42px] cursor-not-allowed items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800 px-4 text-sm font-medium text-fg-muted opacity-60"
            disabled
            title="The full secret is only available once when you Generate or Regenerate. It cannot be copied again."
            aria-label="Copy unavailable — full secret is one-time only"
          >
            <Copy size={14} />
            Copy
          </button>
          {primary ? (
            <button
              type="button"
              className="btn-secondary h-[42px] rounded-md"
              onClick={() => setConfirmRegen(true)}
            >
              Regenerate
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary h-[42px] rounded-md disabled:opacity-40"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Generate
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-fg-muted">
        Full secrets are shown once at Generate/Regenerate, then Copy is locked. The field above is a
        masked identifier only — regenerate if you lost the key.
        {activeTokens.length > 1
          ? ` You have ${activeTokens.length} active personal tokens.`
          : ''}
      </p>

      {confirmRegen && primary && (
        <Modal open title="Regenerate API token?" onClose={() => setConfirmRegen(false)} width="max-w-sm">
          <p className="text-sm text-fg-secondary">
            A new secret will be issued. The previous token remains valid briefly during the rotation
            grace period, then stops working.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setConfirmRegen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={rotateMutation.isPending}
              onClick={() => rotateMutation.mutate(primary.id)}
            >
              Regenerate
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}

/** Connected apps only — creation lives exclusively under FlowDesk API Settings. */
function ConnectedCustomApps() {
  const queryClient = useQueryClient()
  const [unauthTarget, setUnauthTarget] = useState<AuthorizedOAuthApp | null>(null)

  const listQuery = useQuery({
    queryKey: ['oauth-authorized-apps'],
    queryFn: () => api.get<AuthorizedOAuthApp[]>('/oauth/integrations/authorized-apps'),
    retry: false,
  })

  const unauthMutation = useMutation({
    mutationFn: (appId: string) =>
      api.delete(`/oauth/integrations/authorized-apps/${appId}`),
    onSuccess: () => {
      setUnauthTarget(null)
      queryClient.invalidateQueries({ queryKey: ['oauth-authorized-apps'] })
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
      toast.success('App removed from your authorized apps')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const apps = listQuery.data ?? []

  return (
    <section>
      <h3 className="text-base font-semibold text-fg">Custom Apps</h3>
      <p className="mt-2 flex items-start gap-2 text-sm text-fg-secondary">
        <Info size={15} className="mt-0.5 shrink-0 text-fg-muted" />
        <span>
          Do you want to create your own app?{' '}
          <Link
            to="/app/developers/oauth-apps"
            className="underline decoration-ink-600 underline-offset-2 hover:text-fg"
          >
            Check out the API Documentation
          </Link>
          .
        </span>
      </p>

      {listQuery.isLoading ? (
        <div className="mt-4 h-28 animate-pulse rounded-lg bg-ink-750" />
      ) : listQuery.isError ? (
        <p className="mt-4 text-sm text-fg-muted">{errorMessage(listQuery.error)}</p>
      ) : apps.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">
          No connected apps yet. After you authorize an integration, it will appear here. Create apps
          under FlowDesk API Settings.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 overflow-visible sm:grid-cols-2">
          {apps.map((app) => (
            <AuthorizedAppTile
              key={app.app_id}
              app={app}
              onUnauth={() => setUnauthTarget(app)}
            />
          ))}
        </div>
      )}

      {unauthTarget && (
        <UnauthorizeAppModal
          appName={unauthTarget.name}
          pending={unauthMutation.isPending}
          onCancel={() => setUnauthTarget(null)}
          onConfirm={() => unauthMutation.mutate(unauthTarget.app_id)}
        />
      )}
    </section>
  )
}

function AuthorizedAppTile({
  app,
  onUnauth,
}: {
  app: AuthorizedOAuthApp
  onUnauth: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const workspacesQuery = useQuery({
    queryKey: ['workspaces', app.organization_id],
    queryFn: () => api.get<Workspace[]>(`/organizations/${app.organization_id}/workspaces`),
    enabled: menuOpen,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const workspaces = workspacesQuery.data ?? []
  const workspaceLabel = `${app.workspace_count} Workspace${app.workspace_count === 1 ? '' : 's'}`

  return (
    <div
      ref={rootRef}
      className="group relative flex min-h-28 flex-col items-center justify-center overflow-visible rounded-lg border border-ink-700 bg-ink-800 px-4 py-6 text-center shadow-sm transition hover:border-ink-600 hover:bg-ink-750"
    >
      <button
        type="button"
        aria-label={`Unauthorize ${app.name}`}
        onClick={onUnauth}
        className="absolute right-2 top-2 rounded p-0.5 text-rose-500 opacity-0 transition group-hover:opacity-100 hover:bg-ink-750 hover:text-rose-600"
      >
        <X size={16} strokeWidth={2.5} />
      </button>
      <span className="text-sm font-semibold text-fg">{app.name}</span>
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((open) => !open)}
        className="mt-2 inline-flex items-center gap-1 border-b border-dotted border-fg-muted text-xs text-fg-secondary transition hover:border-fg hover:text-fg"
      >
        {workspaceLabel}
        <ChevronDown
          size={12}
          className={cn('transition-transform', menuOpen && 'rotate-180')}
        />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute left-1/2 top-[calc(100%-0.35rem)] z-30 w-56 -translate-x-1/2 rounded-lg border border-ink-700 bg-ink-800 py-1 text-left shadow-popover"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm text-fg hover:bg-ink-750"
            onClick={() => {
              setMenuOpen(false)
              onUnauth()
            }}
          >
            <span>Unauth all</span>
            <Check size={14} className="shrink-0 text-fg-muted" />
          </button>

          {workspacesQuery.isLoading ? (
            <p className="border-t border-ink-700 px-3 py-2 text-xs text-fg-muted">Loading…</p>
          ) : workspacesQuery.isError ? (
            <p className="border-t border-ink-700 px-3 py-2 text-xs text-fg-muted">
              Could not load workspaces
            </p>
          ) : workspaces.length === 0 ? (
            <p className="border-t border-ink-700 px-3 py-2 text-xs text-fg-muted">
              No workspaces found
            </p>
          ) : (
            workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="menuitem"
                className="flex w-full items-center justify-between gap-3 border-t border-ink-700 px-3 py-2 text-sm text-fg hover:bg-ink-750"
                onClick={() => {
                  setMenuOpen(false)
                  onUnauth()
                }}
              >
                <span className="truncate">{workspace.name}</span>
                <Check size={14} className="shrink-0 text-fg-muted" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function StopSignIllustration({ tone = 'unauthorize' }: { tone?: 'unauthorize' | 'delete' }) {
  const signBg = tone === 'delete' ? 'bg-violet-600' : 'bg-red-600'
  const titleColor = tone === 'delete' ? 'text-pink-400' : 'text-pink-400'
  return (
    <div className="flex flex-col items-center">
      <div className="relative mb-3 flex h-24 w-28 items-end justify-center">
        <div className="absolute bottom-2 h-16 w-10 rounded-t-full bg-zinc-200" />
        <div
          className={cn(
            'relative z-10 mb-10 flex h-14 w-14 items-center justify-center rounded-lg border-2 border-white shadow-lg',
            signBg,
          )}
        >
          <span className="text-[10px] font-black tracking-wide text-white">STOP!</span>
        </div>
      </div>
      <p className={cn('text-lg font-semibold', titleColor)}>
        {tone === 'delete' ? 'Delete:' : 'Unauthorize App'}
      </p>
    </div>
  )
}

function UnauthorizeAppModal({
  appName,
  pending,
  onCancel,
  onConfirm,
}: {
  appName: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open onClose={onCancel} width="max-w-md" hideCloseButton>
      <div className="relative px-2 pb-2 pt-1 text-center">
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          className="absolute -right-1 -top-1 rounded-full p-1.5 text-fg-muted hover:bg-ink-800 hover:text-fg"
        >
          <X size={16} />
        </button>
        <StopSignIllustration tone="unauthorize" />
        <p className="mt-3 text-sm text-fg-secondary">
          Warning: Are you sure you want to permanently remove the{' '}
          <span className="font-semibold text-fg">{appName}</span> app from your authorized apps?
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" className="btn-secondary justify-center" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary justify-center disabled:opacity-50"
            disabled={pending}
            onClick={onConfirm}
          >
            Remove
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ───────────────────────── Tab 2: FlowDesk API Settings ───────────────────────── */

function ApiSettingsPane({ onOAuthSecret }: { onOAuthSecret: (s: EphemeralOAuthSecret) => void }) {
  const queryClient = useQueryClient()
  const { org } = useCurrentContext()
  const orgId = org?.id
  const canManage = isOrgAdmin(org?.my_role)

  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [redirectText, setRedirectText] = useState('')

  const listQuery = useQuery({
    queryKey: ['oauth-apps', orgId],
    queryFn: () => api.get<OAuthApp[]>(`/organizations/${orgId}/oauth-apps`),
    enabled: !!orgId && canManage,
    retry: false,
  })

  const apps = (listQuery.data ?? []).filter((a) => !a.revoked_at)

  const createMutation = useMutation({
    mutationFn: (body: { name: string; redirect_uris: string[] }) =>
      api.post<OAuthAppCreated>(`/organizations/${orgId}/oauth-apps`, body),
    onSuccess: (data) => {
      setCreateOpen(false)
      setName('')
      setRedirectText('')
      setExpandedId(data.id)
      queryClient.invalidateQueries({ queryKey: ['oauth-apps', orgId] })
      onOAuthSecret({
        appId: data.id,
        clientId: data.client_id,
        clientSecret: data.client_secret,
        envSnippet: data.env_snippet,
        authorizeUrlTemplate: data.authorize_url_template,
        tokenUrl: data.token_url,
        reason: 'created',
      })
      toast.success('App created')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!orgId) {
    return <p className="text-sm text-fg-secondary">Select an organization to manage API apps.</p>
  }

  if (!canManage) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-900/40 px-6 py-10 text-center">
        <AlertTriangle className="mx-auto text-amber-400" size={28} />
        <h2 className="mt-3 text-base font-semibold text-fg">Org admin required</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Only organization owners and admins can create Custom Apps under FlowDesk API Settings.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight text-fg">FlowDesk API Settings</h2>

      <div className="flex flex-col gap-3 rounded-md border border-ink-700 bg-ink-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-secondary">
          Build an app that makes FlowDesk better. Check out{' '}
          <Link
            to="/app/developers/oauth-apps"
            className="underline decoration-ink-600 underline-offset-2 hover:text-fg"
          >
            API Documentation
          </Link>{' '}
          to get started.
        </p>
        <button
          type="button"
          className="btn-secondary shrink-0"
          onClick={() => setCreateOpen(true)}
        >
          <Plus size={14} />
          Create an App
        </button>
      </div>

      {listQuery.isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-ink-750" />
      ) : listQuery.isError ? (
        <div className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-6 text-center text-sm text-fg-secondary">
          {errorMessage(listQuery.error)}
          <button type="button" className="btn-secondary mt-3" onClick={() => listQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {apps.map((app) => (
            <AppEditorCard
              key={app.id}
              app={app}
              orgId={orgId}
              expanded={expandedId === app.id}
              onToggle={() => setExpandedId(expandedId === app.id ? null : app.id)}
              onOAuthSecret={onOAuthSecret}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <Modal open title="Create an App" onClose={() => setCreateOpen(false)} width="max-w-md">
          <label className="block text-xs font-medium text-fg-muted">App Name</label>
          <input
            className="input mt-1 w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My integration"
            autoFocus
          />
          <label className="mt-4 block text-xs font-medium text-fg-muted">Redirect URL(s)</label>
          <p className="mt-0.5 text-[11px] text-fg-muted">Enter one per line (only one required).</p>
          <textarea
            className="input mt-2 min-h-[88px] w-full font-mono text-xs"
            value={redirectText}
            onChange={(e) => setRedirectText(e.target.value)}
            placeholder="https://your-app.example.com/oauth/callback"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={createMutation.isPending}
              onClick={() => {
                const uris = redirectText
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                if (!name.trim()) {
                  toast.error('App name is required')
                  return
                }
                if (!uris.length) {
                  toast.error('At least one redirect URL is required')
                  return
                }
                createMutation.mutate({ name: name.trim(), redirect_uris: uris })
              }}
            >
              Create App
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function AppEditorCard({
  app,
  orgId,
  expanded,
  onToggle,
  onOAuthSecret,
}: {
  app: OAuthApp
  orgId: string
  expanded: boolean
  onToggle: () => void
  onOAuthSecret: (s: EphemeralOAuthSecret) => void
}) {
  const queryClient = useQueryClient()
  const [redirectText, setRedirectText] = useState(app.redirect_uris.join('\n'))
  const [showSecret, setShowSecret] = useState(false)
  const [dirty, setDirty] = useState(false)
  /** Safety latch — when off, delete (X) becomes available. */
  const [enabled, setEnabled] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmName, setConfirmName] = useState('')

  useEffect(() => {
    setRedirectText(app.redirect_uris.join('\n'))
    setDirty(false)
    setEnabled(true)
  }, [app.id, app.redirect_uris])

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch<OAuthApp>(`/organizations/${orgId}/oauth-apps/${app.id}`, {
        redirect_uris: redirectText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['oauth-apps', orgId] })
      toast.success('Saved')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const regenMutation = useMutation({
    mutationFn: () =>
      api.post<OAuthAppCreated>(`/organizations/${orgId}/oauth-apps/${app.id}/regenerate-secret`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['oauth-apps', orgId] })
      onOAuthSecret({
        appId: data.id,
        clientId: data.client_id,
        clientSecret: data.client_secret,
        envSnippet: data.env_snippet,
        authorizeUrlTemplate: data.authorize_url_template,
        tokenUrl: data.token_url,
        reason: 'regenerated',
      })
      toast.success('Client secret regenerated')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/organizations/${orgId}/oauth-apps/${app.id}`),
    onSuccess: () => {
      setConfirmDelete(false)
      setConfirmName('')
      queryClient.invalidateQueries({ queryKey: ['oauth-apps', orgId] })
      queryClient.invalidateQueries({ queryKey: ['oauth-authorized-apps'] })
      toast.success('App deleted')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="group relative overflow-hidden rounded-md border border-ink-700 bg-ink-800 shadow-sm">
      {!enabled && (
        <button
          type="button"
          aria-label={`Delete ${app.name}`}
          onClick={() => {
            setConfirmName('')
            setConfirmDelete(true)
          }}
          className="absolute right-10 top-3.5 z-10 rounded p-0.5 text-rose-500 opacity-0 transition group-hover:opacity-100 hover:bg-ink-750 hover:text-rose-600"
        >
          <X size={16} strokeWidth={2.5} />
        </button>
      )}

      <div className="flex w-full items-center gap-3 px-4 py-3.5">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? 'App enabled — turn off to delete' : 'App disabled — delete available'}
          onClick={() => setEnabled((v) => !v)}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 rounded-full transition',
            enabled ? 'bg-brand' : 'bg-ink-600',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition',
              enabled ? 'right-0.5' : 'left-0.5',
            )}
          />
        </button>

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={onToggle}
        >
          <span className="truncate text-sm font-medium text-fg">{app.name}</span>
        </button>

        <button
          type="button"
          className="rounded p-1 text-fg-muted hover:bg-ink-750 hover:text-fg"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-ink-700 bg-ink-750/50 px-4 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-fg-muted">Client ID</label>
                <input
                  readOnly
                  className="input mt-1.5 w-full font-mono text-xs"
                  value={app.client_id}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-fg-muted">Client Secret</label>
                <div className="relative mt-1.5">
                  <input
                    readOnly
                    className="input w-full pr-[9.5rem] font-mono text-xs"
                    value={
                      showSecret
                        ? `••••••••••••••••…${app.display_suffix}`
                        : maskSecretDots(48)
                    }
                  />
                  <div className="absolute inset-y-0 right-1 flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs font-medium text-fg-secondary hover:bg-ink-750 hover:text-fg"
                      onClick={() => setShowSecret((v) => !v)}
                    >
                      {showSecret ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs font-medium text-fg-secondary hover:bg-ink-750 hover:text-fg disabled:opacity-40"
                      disabled={regenMutation.isPending}
                      onClick={() => regenMutation.mutate()}
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-fg-muted">Redirect URL(s)</label>
              <textarea
                className="input mt-1.5 min-h-[118px] w-full font-mono text-xs"
                value={redirectText}
                onChange={(e) => {
                  setRedirectText(e.target.value)
                  setDirty(true)
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setRedirectText(app.redirect_uris.join('\n'))
                setDirty(false)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={
                dirty
                  ? 'btn-primary'
                  : 'inline-flex cursor-default items-center justify-center rounded-lg border border-ink-700 bg-ink-750 px-4 py-2 text-sm font-medium text-fg-muted'
              }
              disabled={!dirty || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {dirty ? 'Save' : 'Saved'}
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <Modal
          open
          title="Delete App"
          onClose={() => {
            setConfirmDelete(false)
            setConfirmName('')
          }}
          width="max-w-md"
        >
          <div className="text-center">
            <StopSignIllustration tone="delete" />
            <p className="mt-3 text-sm text-fg-secondary">
              Warning: Are you sure you want to permanently delete the{' '}
              <span className="font-semibold text-fg">{app.name}</span> app? This will also delete any
              associated authorizations. Type the app&apos;s name to confirm.
            </p>
            <input
              className="input mt-4 w-full text-center"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={app.name}
              autoFocus
            />
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="btn-secondary justify-center"
                onClick={() => {
                  setConfirmDelete(false)
                  setConfirmName('')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary justify-center disabled:opacity-40"
                disabled={
                  deleteMutation.isPending || confirmName.trim() !== app.name
                }
                onClick={() => deleteMutation.mutate()}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
