import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Clock, ScrollText, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext } from '../../lib/queries'
import type { AuditLog, Page, TimeEntry, User } from '../../lib/types'
import { cn, formatDateTime, formatDuration } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar } from '../../components/ui/Avatar'
import { CenteredSpinner } from '../../components/ui/Spinner'

type Tab = 'profile' | 'organization' | 'audit' | 'time'

export default function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'profile'
  const { org } = useCurrentContext()
  const isOwner = org?.my_role === 'owner'

  const setTab = (t: Tab) => {
    params.set('tab', t)
    setParams(params, { replace: true })
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-7">
      <h1 className="text-xl font-bold text-fg">Settings</h1>
      <div className="mt-4 flex gap-1 border-b border-ink-700">
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')} icon={<UserIcon size={14} />}>
          Profile
        </TabButton>
        {isOwner && (
          <TabButton active={tab === 'organization'} onClick={() => setTab('organization')} icon={<Building2 size={14} />}>
            Organization
          </TabButton>
        )}
        {isOwner && (
          <TabButton active={tab === 'audit'} onClick={() => setTab('audit')} icon={<ScrollText size={14} />}>
            Audit log
          </TabButton>
        )}
        <TabButton active={tab === 'time'} onClick={() => setTab('time')} icon={<Clock size={14} />}>
          My time
        </TabButton>
      </div>

      <div className="py-6">
        {tab === 'profile' && <ProfileTab />}
        {tab === 'organization' && isOwner && <OrganizationTab />}
        {tab === 'audit' && isOwner && <AuditTab />}
        {tab === 'time' && <TimeTab />}
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
        'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
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
    <div className="max-w-md space-y-4">
      <div className="flex items-center gap-4">
        <Avatar name={fullName || user?.email || '?'} src={user?.profile?.avatar_url} size={56} />
        <div>
          <p className="text-sm font-semibold text-fg">{user?.email}</p>
          <p className="text-xs text-fg-muted">
            Signed in via {user?.auth_provider === 'google' ? 'Google SSO' : 'email & password'}
          </p>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Full name</label>
        <input className="input-dark" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Job title</label>
        <input className="input-dark" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Product Engineer" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Timezone</label>
        <input className="input-dark" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
      </div>
      <button className="btn-primary" disabled={saving || !fullName.trim()} onClick={save}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

function OrganizationTab() {
  const { org } = useCurrentContext()
  const queryClient = useQueryClient()
  const [name, setName] = useState(org?.name ?? '')
  const [saving, setSaving] = useState(false)

  const members = useQuery({
    queryKey: ['org-members', org?.id],
    queryFn: () => api.get<{ id: string; user_id: string; role: string; user: { full_name: string; email: string; avatar_url: string | null } | null }[]>(`/organizations/${org!.id}/members`),
    enabled: !!org,
  })

  if (!org) return null

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

  return (
    <div className="space-y-7">
      <section className="max-w-md space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Organization name</label>
          <input className="input-dark" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex items-center gap-4 text-xs text-fg-muted">
          <span>Slug: {org.slug}</span>
          <span>Plan: {org.plan} (billing placeholder)</span>
          <span>Seats: {org.seats}</span>
        </div>
        <button className="btn-primary" disabled={saving || !name.trim()} onClick={save}>
          Save
        </button>
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
