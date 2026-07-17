import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  AppWindow,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, ApiError, errorMessage } from '../../../lib/api'
import {
  type EphemeralOAuthSecret,
  type OAuthApp,
  type OAuthAppCreated,
  maskClientId,
  suggestRedirectFromHolocronBase,
  suggestWebhookFromHolocronBase,
} from '../../../lib/oauthApps'
import { useCurrentContext } from '../../../lib/queries'
import { cn, formatDateTime } from '../../../lib/utils'
import { toast } from '../../../stores/toast'
import { EmptyState } from '../../ui/EmptyState'
import { Modal } from '../../ui/Modal'
import { OAuthSecretRevealDialog } from './OAuthSecretRevealDialog'

function isOrgAdmin(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function OAuthAppsSection() {
  const queryClient = useQueryClient()
  const { org } = useCurrentContext()
  const orgId = org?.id
  const canManage = isOrgAdmin(org?.my_role)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [holocronBase, setHolocronBase] = useState('')
  const [redirectText, setRedirectText] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<OAuthApp | null>(null)
  const [ephemeral, setEphemeral] = useState<EphemeralOAuthSecret | null>(null)

  const listQuery = useQuery({
    queryKey: ['oauth-apps', orgId],
    queryFn: () => api.get<OAuthApp[]>(`/organizations/${orgId}/oauth-apps`),
    enabled: !!orgId && canManage,
    retry: false,
  })

  const createMutation = useMutation({
    mutationFn: (body: { name: string; redirect_uris: string[] }) =>
      api.post<OAuthAppCreated>(`/organizations/${orgId}/oauth-apps`, body),
    onSuccess: (data) => {
      setCreateOpen(false)
      setName('')
      setHolocronBase('')
      setRedirectText('')
      setEphemeral({
        appId: data.id,
        clientId: data.client_id,
        clientSecret: data.client_secret,
        envSnippet: data.env_snippet,
        authorizeUrlTemplate: data.authorize_url_template,
        tokenUrl: data.token_url,
        reason: 'created',
      })
      queryClient.invalidateQueries({ queryKey: ['oauth-apps', orgId] })
      toast.success('OAuth app created')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const regenerateMutation = useMutation({
    mutationFn: (appId: string) =>
      api.post<OAuthAppCreated>(`/organizations/${orgId}/oauth-apps/${appId}/regenerate-secret`),
    onSuccess: (data) => {
      setMenuId(null)
      setEphemeral({
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

  const revokeMutation = useMutation({
    mutationFn: (appId: string) =>
      api.delete(`/organizations/${orgId}/oauth-apps/${appId}`),
    onSuccess: () => {
      setRevokeTarget(null)
      queryClient.invalidateQueries({ queryKey: ['oauth-apps', orgId] })
      toast.success('OAuth app revoked')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const suggestedRedirect = useMemo(
    () => suggestRedirectFromHolocronBase(holocronBase),
    [holocronBase],
  )
  const suggestedWebhook = useMemo(
    () => suggestWebhookFromHolocronBase(holocronBase),
    [holocronBase],
  )

  const applyHolocronBase = () => {
    if (suggestedRedirect) setRedirectText(suggestedRedirect)
  }

  const submitCreate = () => {
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
  }

  if (!orgId) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 px-6 py-10 text-center text-sm text-fg-secondary">
        Select an organization to manage OAuth apps.
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 px-6 py-10 text-center">
        <AlertTriangle className="mx-auto text-amber-400" size={28} />
        <h2 className="mt-3 text-base font-semibold text-fg">Org admin required</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Only organization owners and admins can create OAuth apps for Holocron / Brightcone
          (same as ClickUp Custom Apps).
        </p>
      </div>
    )
  }

  const forbidden =
    listQuery.error instanceof ApiError &&
    (listQuery.error.status === 401 || listQuery.error.status === 403)

  if (forbidden) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-900 px-6 py-10 text-center text-sm text-fg-secondary">
        You do not have permission to manage OAuth apps.
      </div>
    )
  }

  const apps = listQuery.data ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg">Custom Apps</h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
            Create an OAuth app for Holocron / Brightcone (ClickUp-style). Put{' '}
            <code className="text-xs">client_id</code> and{' '}
            <code className="text-xs">client_secret</code> in Holocron&apos;s{' '}
            <code className="text-xs">.env</code>, then connect via OAuth. API actions run as the
            FlowDesk user who authorizes — not a shared pasted PAT.
          </p>
          <p className="mt-2 text-sm">
            <Link to="/app/developers/authentication" className="text-brand hover:underline">
              Developer documentation
            </Link>
            <span className="text-fg-muted"> · OAuth apps, token exchange, webhooks</span>
          </p>
        </div>
        <button type="button" className="btn-primary shrink-0 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          Create an App
        </button>
      </div>

      {listQuery.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-ink-800" />
      ) : listQuery.isError ? (
        <div className="rounded-xl border border-ink-700 px-4 py-6 text-center text-sm text-fg-secondary">
          {errorMessage(listQuery.error)}
          <button type="button" className="btn-secondary mt-3" onClick={() => listQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon={AppWindow}
          title="No custom apps yet"
          description="Create an app to get client_id and client_secret for Holocron."
        />
      ) : (
        <ul className="space-y-2">
          {apps.map((app) => (
            <li
              key={app.id}
              className="relative flex items-start justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{app.name}</span>
                  {app.revoked_at && (
                    <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-300">
                      Revoked
                    </span>
                  )}
                </div>
                <p className="mt-1 font-mono text-xs text-fg-muted">{maskClientId(app.client_id)}</p>
                <p className="mt-1 truncate text-xs text-fg-secondary">
                  Redirect: {app.redirect_uris[0] || '—'}
                  {app.redirect_uris.length > 1 ? ` (+${app.redirect_uris.length - 1})` : ''}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Created {formatDateTime(app.created_at)} · secret …{app.display_suffix}
                </p>
              </div>
              {!app.revoked_at && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    className="btn-ghost p-2"
                    onClick={() => setMenuId(menuId === app.id ? null : app.id)}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {menuId === app.id && (
                    <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-lg">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-ink-800"
                        onClick={() => regenerateMutation.mutate(app.id)}
                      >
                        <RotateCcw size={14} />
                        Regenerate secret
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-300 hover:bg-ink-800"
                        onClick={() => {
                          setMenuId(null)
                          setRevokeTarget(app)
                        }}
                      >
                        <Trash2 size={14} />
                        Revoke app
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {createOpen && (
        <Modal open title="Create an App" onClose={() => setCreateOpen(false)} width="max-w-md">
          <label className="block text-xs font-medium text-fg-muted">App name</label>
          <input
            className="input mt-1 w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Holocron"
            autoFocus
          />

          <label className="mt-4 block text-xs font-medium text-fg-muted">
            Holocron API base (optional helper)
          </label>
          <div className="mt-1 flex gap-2">
            <input
              className="input w-full"
              value={holocronBase}
              onChange={(e) => setHolocronBase(e.target.value)}
              placeholder="https://holocron-api.example.com"
            />
            <button type="button" className="btn-secondary shrink-0" onClick={applyHolocronBase}>
              Fill
            </button>
          </div>
          {suggestedWebhook && (
            <p className="mt-1 text-[11px] text-fg-muted">
              Suggested webhook for Holocron .env:{' '}
              <code className="font-mono">{suggestedWebhook}</code>
            </p>
          )}

          <label className="mt-4 block text-xs font-medium text-fg-muted">
            Redirect URL(s) — one per line
          </label>
          <textarea
            className="input mt-1 min-h-[88px] w-full font-mono text-xs"
            value={redirectText}
            onChange={(e) => setRedirectText(e.target.value)}
            placeholder="https://<holocron-api>/api/v1/tools/config/oauth/callback"
          />
          <p className="mt-1 text-[11px] text-fg-muted">
            Must match Holocron&apos;s{' '}
            <code className="font-mono">FLOWDESK_REDIRECT_URI</code> exactly.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={createMutation.isPending}
              onClick={submitCreate}
            >
              Create App
            </button>
          </div>
        </Modal>
      )}

      {revokeTarget && (
        <Modal open title="Revoke OAuth app?" onClose={() => setRevokeTarget(null)} width="max-w-sm">
          <p className="text-sm text-fg-secondary">
            Revoke <span className="font-medium text-fg">{revokeTarget.name}</span>? Holocron will no
            longer be able to exchange codes with this client_id.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setRevokeTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={cn('btn-primary bg-red-600 hover:bg-red-500')}
              disabled={revokeMutation.isPending}
              onClick={() => revokeMutation.mutate(revokeTarget.id)}
            >
              Revoke
            </button>
          </div>
        </Modal>
      )}

      {ephemeral && (
        <OAuthSecretRevealDialog secret={ephemeral} onClose={() => setEphemeral(null)} />
      )}
    </div>
  )
}
