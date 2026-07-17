import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Clock, KeyRound, Plug, ScrollText, ShieldCheck, User as UserIcon, Webhook } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'

import { api, confirm2fa, disable2fa, errorMessage, get2faStatus, setup2fa } from '../../lib/api'
import { useCurrentContext } from '../../lib/queries'
import type { AuditLog, Page, TimeEntry, TotpSetupResponse, User } from '../../lib/types'
import { cn, formatDateTime, formatDuration } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { ApiKeysTab } from '../../components/settings/ApiKeysTab'
import { ConnectionsTab } from '../../components/settings/ConnectionsTab'
import { WebhooksTab } from '../../components/settings/WebhooksTab'
import { Avatar } from '../../components/ui/Avatar'
import { CenteredSpinner } from '../../components/ui/Spinner'

type Tab = 'profile' | 'security' | 'connections' | 'api-keys' | 'organization' | 'audit' | 'webhooks' | 'time'

export default function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'profile'
  const { org } = useCurrentContext()
  const isOwner = org?.my_role === 'owner' || org?.my_role === 'admin'

  const setTab = (t: Tab) => {
    params.set('tab', t)
    setParams(params, { replace: true })
  }

  return (
    <div className="w-full px-6 py-6 lg:px-8">
      <div className="w-full max-w-6xl">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-fg">Settings</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Manage your profile, security, integrations, and organization.
          </p>
        </div>

        <div className="-mx-1 mt-5 flex gap-0.5 overflow-x-auto border-b border-ink-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabButton active={tab === 'profile'} onClick={() => setTab('profile')} icon={<UserIcon size={14} />}>
            Profile
          </TabButton>
          <TabButton active={tab === 'security'} onClick={() => setTab('security')} icon={<ShieldCheck size={14} />}>
            Security
          </TabButton>
          <TabButton active={tab === 'connections'} onClick={() => setTab('connections')} icon={<Plug size={14} />}>
            MCP
          </TabButton>
          <TabButton active={tab === 'api-keys'} onClick={() => setTab('api-keys')} icon={<KeyRound size={14} />}>
            API Keys
          </TabButton>
          {isOwner && (
            <TabButton
              active={tab === 'organization'}
              onClick={() => setTab('organization')}
              icon={<Building2 size={14} />}
            >
              Organization
            </TabButton>
          )}
          {isOwner && (
            <TabButton active={tab === 'audit'} onClick={() => setTab('audit')} icon={<ScrollText size={14} />}>
              Audit log
            </TabButton>
          )}
          {isOwner && (
            <TabButton active={tab === 'webhooks'} onClick={() => setTab('webhooks')} icon={<Webhook size={14} />}>
              Webhooks
            </TabButton>
          )}
          <TabButton active={tab === 'time'} onClick={() => setTab('time')} icon={<Clock size={14} />}>
            My time
          </TabButton>
        </div>

        <div className="pt-6">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'security' && <TwoFactorTab />}
          {tab === 'connections' && <ConnectionsTab />}
          {tab === 'api-keys' && <ApiKeysTab />}
          {tab === 'organization' && isOwner && (
            <OrganizationTab openTransfer={params.get('transfer') === '1'} />
          )}
          {tab === 'audit' && isOwner && <AuditTab />}
          {tab === 'webhooks' && isOwner && <WebhooksTab />}
          {tab === 'time' && <TimeTab />}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors',
        active ? 'border-brand font-medium text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function ProfileTab() {
  const { user, setUser } = useAuthStore()
  const [fullName, setFullName] = useState(user?.profile?.full_name ?? '')
  const [title, setTitle] = useState(user?.profile?.title ?? '')
  const [timezone, setTimezone] = useState(user?.profile?.timezone ?? 'UTC')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.patch<User>('/users/me/profile', {
        full_name: fullName.trim(),
        title: title.trim() || null,
        timezone,
      })
      setUser(updated)
      toast.success('Profile updated')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4 rounded-xl border border-ink-700 bg-ink-900/50 px-4 py-4">
        <Avatar name={fullName || user?.email || '?'} src={user?.profile?.avatar_url} size={56} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{user?.email}</p>
          <p className="text-xs text-fg-muted">
            Signed in via {user?.auth_provider === 'google' ? 'Google SSO' : 'email & password'}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Full name</label>
          <input className="input-dark" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Job title</label>
          <input
            className="input-dark"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Product Engineer"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Timezone</label>
          <input
            className="input-dark"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="UTC"
            list="profile-timezone-options"
          />
          <datalist id="profile-timezone-options">
            <option value="UTC" />
            <option value="IST" />
            <option value="Asia/Kolkata" />
            <option value="America/New_York" />
            <option value="America/Los_Angeles" />
            <option value="Europe/London" />
            <option value="Europe/Paris" />
            <option value="Asia/Tokyo" />
            <option value="Australia/Sydney" />
          </datalist>
        </div>
      </div>
      <p className="text-[11px] text-fg-muted">
        Analytics charts and day boundaries use this timezone (e.g. IST or Asia/Kolkata).
      </p>
      <button className="btn-primary" disabled={saving || !fullName.trim()} onClick={save}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

function TwoFactorTab() {
  const queryClient = useQueryClient()
  const { setUser } = useAuthStore()
  const status = useQuery({ queryKey: ['2fa-status'], queryFn: get2faStatus })
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshUser = async () => {
    try {
      const me = await api.get<{ user: User }>('/auth/me')
      setUser(me.user)
    } catch {
      /* ignore — status query already reflects the change */
    }
  }

  const begin = async () => {
    setBusy(true)
    try {
      const s = await setup2fa()
      setSetup(s)
      setCode('')
      setRecoveryCodes(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (code.trim().length < 6) return
    setBusy(true)
    try {
      const res = await confirm2fa(code.trim())
      setRecoveryCodes(res.recovery_codes)
      setSetup(null)
      await refreshUser()
      void queryClient.invalidateQueries({ queryKey: ['2fa-status'] })
      toast.success('Two-factor authentication enabled')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await disable2fa()
      await refreshUser()
      void queryClient.invalidateQueries({ queryKey: ['2fa-status'] })
      toast.success('Two-factor authentication disabled')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (status.isLoading) return <CenteredSpinner />
  const enrolled = status.data?.enrolled
  const orgRequired = status.data?.org_required

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-fg">Two-factor authentication (2FA)</h3>
        <p className="mt-1 max-w-xl text-sm text-fg-muted">
          Add a one-time code from an authenticator app to your email sign-in. SSO logins use your
          provider&apos;s own MFA.
        </p>
      </div>

      {recoveryCodes && (
        <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-4">
          <p className="text-xs text-fg-secondary">
            Save these one-time recovery codes somewhere safe — each works once if you lose your authenticator.
          </p>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs text-fg">
            {recoveryCodes.map((rc) => (
              <span key={rc} className="text-center tracking-wide">{rc}</span>
            ))}
          </div>
        </div>
      )}

      {enrolled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
            <ShieldCheck size={16} /> Enabled
            <span className="ml-auto text-xs text-fg-muted">{status.data?.recovery_codes_remaining} recovery codes left</span>
          </div>
          {orgRequired ? (
            <p className="text-xs text-fg-muted">Your organization requires 2FA, so it can't be turned off.</p>
          ) : (
            <button className="btn-ghost text-red-400 hover:bg-red-500/10" disabled={busy} onClick={disable}>
              Disable 2FA
            </button>
          )}
        </div>
      ) : setup ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void confirm() }}>
          <p className="text-xs text-fg-secondary">
            Scan with Google Authenticator, Authy, or 1Password, then enter the 6-digit code.
          </p>
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={setup.otpauth_uri} size={160} />
            </div>
            <p className="break-all text-center font-mono text-[11px] text-fg-muted">{setup.secret}</p>
          </div>
          <input
            className="input-dark text-center tracking-[0.3em]"
            inputMode="numeric"
            maxLength={6}
            placeholder="Enter 6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy || code.trim().length < 6}>
              {busy ? 'Verifying…' : 'Verify & enable'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setSetup(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          {orgRequired && (
            <p className="text-xs text-amber-500">Your organization requires two-factor authentication.</p>
          )}
          <button className="btn-primary" disabled={busy} onClick={begin}>
            {busy ? 'Starting…' : 'Enable 2FA'}
          </button>
        </div>
      )}
    </div>
  )
}

type OrgMember = { id: string; user_id: string; role: string; user: { full_name: string; email: string; avatar_url: string | null } | null }

function OrganizationTab({ openTransfer }: { openTransfer?: boolean }) {
  const { org } = useCurrentContext()
  const queryClient = useQueryClient()
  const [name, setName] = useState(org?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [require2fa, setRequire2fa] = useState(!!org?.require_2fa)
  const [saving2fa, setSaving2fa] = useState(false)
  const [transferTo, setTransferTo] = useState('')
  const [transferConfirm, setTransferConfirm] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferring, setTransferring] = useState(false)

  useEffect(() => {
    if (openTransfer) setShowTransfer(true)
  }, [openTransfer])

  const members = useQuery({
    queryKey: ['org-members', org?.id],
    queryFn: () => api.get<OrgMember[]>(`/organizations/${org!.id}/members`),
    enabled: !!org,
  })

  if (!org) return null

  const isOwner = org.my_role === 'owner'
  const nonOwnerMembers = (members.data ?? []).filter((m) => m.role !== 'owner')

  const transfer = async () => {
    if (!transferTo || transferConfirm !== org.name) return
    setTransferring(true)
    try {
      const target = nonOwnerMembers.find((m) => m.user_id === transferTo)
      await api.post(`/organizations/${org.id}/transfer-ownership`, { new_owner_id: transferTo })
      void queryClient.invalidateQueries({ queryKey: ['organizations'] })
      void queryClient.invalidateQueries({ queryKey: ['org-members', org.id] })
      toast.success(`Ownership transferred to ${target?.user?.full_name ?? target?.user?.email ?? 'new owner'}`)
      setShowTransfer(false)
      setTransferTo('')
      setTransferConfirm('')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setTransferring(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/organizations/${org.id}`, { name: name.trim() })
      void queryClient.invalidateQueries({ queryKey: ['organizations'] })
      toast.success('Organization updated')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const saveRequire2fa = async (next: boolean) => {
    setRequire2fa(next)
    setSaving2fa(true)
    try {
      await api.patch(`/organizations/${org.id}`, { require_2fa: next })
      void queryClient.invalidateQueries({ queryKey: ['organizations'] })
      toast.success(next ? '2FA is now required for all members' : '2FA requirement removed')
    } catch (err) {
      setRequire2fa(!next)
      toast.error(errorMessage(err))
    } finally {
      setSaving2fa(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="max-w-2xl space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Organization name</label>
          <input className="input-dark" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={saving || !name.trim()} onClick={save}>
          Save
        </button>
      </section>

      <section className="max-w-2xl">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">Require two-factor authentication</h3>
            <p className="mt-1 text-xs text-fg-muted">
              Members must set up an authenticator app to sign in with an email code. SSO logins use
              the provider&apos;s own MFA.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={require2fa}
            disabled={saving2fa}
            onClick={() => void saveRequire2fa(!require2fa)}
            className={cn(
              'mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
              require2fa ? 'bg-brand' : 'bg-ink-600',
            )}
          >
            <span
              className={cn(
                'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                require2fa ? 'translate-x-5' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
      </section>

      <section>
        <h3 className="mb-2.5 text-sm font-semibold text-fg">Organization members</h3>
        <div className="overflow-hidden rounded-xl border border-ink-700">
          {(members.data ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 last:border-b-0">
              <Avatar name={m.user?.full_name || m.user?.email || '?'} src={m.user?.avatar_url} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{m.user?.full_name || m.user?.email}</p>
                <p className="truncate text-[11px] text-fg-muted">{m.user?.email}</p>
              </div>
              <span className={cn('rounded px-2 py-0.5 text-[10px] font-semibold uppercase', m.role === 'owner' ? 'bg-brand-soft text-brand' : 'bg-ink-750 text-fg-secondary')}>
                {m.role}
              </span>
            </div>
          ))}
        </div>
      </section>

      {isOwner && (
        <section className="max-w-2xl space-y-3 rounded-xl border border-red-500/30 bg-red-950/20 p-4">
          <div>
            <h3 className="text-sm font-semibold text-red-400">Transfer ownership</h3>
            <p className="mt-1 text-xs text-fg-muted">
              Transfer ownership to another member. You will become an admin. This cannot be undone without the new owner's cooperation.
            </p>
          </div>

          {!showTransfer ? (
            <button
              className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              onClick={() => setShowTransfer(true)}
            >
              Transfer ownership…
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-secondary">New owner</label>
                <select
                  className="input-dark"
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                >
                  <option value="">Select a member…</option>
                  {nonOwnerMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.user?.full_name || m.user?.email} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-fg-secondary">
                  Type <span className="font-mono text-fg">{org.name}</span> to confirm
                </label>
                <input
                  className="input-dark"
                  placeholder={org.name}
                  value={transferConfirm}
                  onChange={(e) => setTransferConfirm(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                  disabled={!transferTo || transferConfirm !== org.name || transferring}
                  onClick={transfer}
                >
                  {transferring ? 'Transferring…' : 'Confirm transfer'}
                </button>
                <button
                  className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-fg-secondary hover:bg-ink-750 transition-colors"
                  onClick={() => { setShowTransfer(false); setTransferTo(''); setTransferConfirm('') }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function AuditTab() {
  const { org } = useCurrentContext()
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['org-audit', org?.id, page],
    queryFn: () => api.get<Page<AuditLog>>(`/organizations/${org!.id}/audit-logs?page=${page}&page_size=30`),
    enabled: !!org,
  })

  if (isLoading) return <CenteredSpinner />
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        {(data?.items ?? []).map((log) => (
          <div key={log.id} className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 last:border-b-0">
            <span className="rounded bg-ink-750 px-2 py-0.5 font-mono text-[11px] text-fg-secondary">{log.action}</span>
            <span className="flex-1 truncate text-xs text-fg-secondary">
              {log.actor?.full_name || 'System'}
              {log.target_type ? ` · ${log.target_type}` : ''}
              {log.target_id ? ` · ${log.target_id.slice(0, 18)}` : ''}
            </span>
            <span className="text-[11px] text-fg-muted">{formatDateTime(log.created_at)}</span>
          </div>
        ))}
        {(data?.items ?? []).length === 0 && (
          <p className="bg-ink-900 px-4 py-6 text-center text-sm text-fg-muted">No audit entries yet.</p>
        )}
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button className="btn-ghost text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="text-xs text-fg-muted">
            {page} / {totalPages}
          </span>
          <button className="btn-ghost text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function TimeTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-time'],
    queryFn: () => api.get<Page<TimeEntry>>('/me/time-entries?page_size=50'),
  })

  if (isLoading) return <CenteredSpinner />
  const entries = data?.items ?? []
  const total = entries.reduce((sum, e) => sum + (e.duration_seconds ?? 0), 0)

  return (
    <div>
      <p className="mb-3 text-sm text-fg-secondary">
        Total tracked (last {entries.length} entries): <strong className="text-fg">{formatDuration(total)}</strong>
      </p>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 last:border-b-0">
            <span className="text-xs text-fg-muted">{entry.task_ref}</span>
            <span className="flex-1 truncate text-sm text-fg">{entry.task_title ?? 'Task'}</span>
            <span className="text-[11px] text-fg-muted">
              {formatDateTime(entry.started_at)}
              {entry.is_manual ? ' · manual' : ''}
              {entry.stopped_by_system ? ' · auto-stopped' : ''}
            </span>
            <span className="w-20 text-right font-mono text-xs text-fg">
              {entry.duration_seconds != null ? formatDuration(entry.duration_seconds) : 'running'}
            </span>
          </div>
        ))}
        {entries.length === 0 && (
          <p className="bg-ink-900 px-4 py-6 text-center text-sm text-fg-muted">
            No time entries yet. Start a timer from any task.
          </p>
        )}
      </div>
    </div>
  )
}
