import { useQuery } from '@tanstack/react-query'
import { Building2, ScrollText, Timer, Users } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../lib/api'
import type { AuditLog, CronJobLog, Page, PlatformStats } from '../../lib/types'
import { cn, formatDateTime } from '../../lib/utils'
import { CenteredSpinner } from '../../components/ui/Spinner'

export default function PlatformAdminPage() {
  const stats = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<PlatformStats>('/admin/stats'),
  })

  const [tab, setTab] = useState<'audit' | 'cron'>('audit')

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-xl font-bold text-fg">Platform overview</h1>
      <p className="mt-0.5 text-sm text-fg-secondary">
        Organization metadata, usage and platform health. Organization private data is not accessible.
      </p>

      <div className="mt-6 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <StatCard icon={<Building2 size={18} className="text-brand" />} label="Organizations" value={stats.data?.organizations} />
        <StatCard icon={<Building2 size={18} className="text-emerald-400" />} label="Active orgs" value={stats.data?.active_organizations} />
        <StatCard icon={<Users size={18} className="text-sky-400" />} label="Users" value={stats.data?.users} />
        <StatCard icon={<Building2 size={18} className="text-amber-400" />} label="Workspaces" value={stats.data?.workspaces} />
      </div>

      <div className="mt-8 flex gap-1 border-b border-ink-700">
        <button
          className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm', tab === 'audit' ? 'border-brand font-medium text-fg' : 'border-transparent text-fg-secondary hover:text-fg')}
          onClick={() => setTab('audit')}
        >
          <ScrollText size={14} /> Platform audit log
        </button>
        <button
          className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm', tab === 'cron' ? 'border-brand font-medium text-fg' : 'border-transparent text-fg-secondary hover:text-fg')}
          onClick={() => setTab('cron')}
        >
          <Timer size={14} /> Cron job logs
        </button>
      </div>

      <div className="py-5">{tab === 'audit' ? <AuditLogs /> : <CronLogs />}</div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3.5">
      {icon}
      <p className="mt-2 text-xl font-bold text-fg">{value ?? '—'}</p>
      <p className="text-xs text-fg-muted">{label}</p>
    </div>
  )
}

function AuditLogs() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', page],
    queryFn: () => api.get<Page<AuditLog>>(`/admin/audit-logs?page=${page}&page_size=30`),
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
              {log.actor?.full_name || log.actor?.email || 'System'}
              {log.target_type ? ` · ${log.target_type}` : ''}
            </span>
            <span className="text-[11px] text-fg-muted">{formatDateTime(log.created_at)}</span>
          </div>
        ))}
        {(data?.items ?? []).length === 0 && (
          <p className="bg-ink-900 px-4 py-6 text-center text-sm text-fg-muted">No audit entries.</p>
        )}
      </div>
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      )}
    </div>
  )
}

function CronLogs() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-cron', page],
    queryFn: () => api.get<Page<CronJobLog>>(`/admin/cron-logs?page=${page}&page_size=30`),
    refetchInterval: 30_000,
  })
  if (isLoading) return <CenteredSpinner />
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-ink-700">
        {(data?.items ?? []).map((log) => (
          <div key={log.id} className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 last:border-b-0">
            <span
              className={cn(
                'w-16 rounded px-2 py-0.5 text-center text-[10px] font-semibold uppercase',
                log.status === 'success' && 'bg-emerald-500/15 text-emerald-400',
                log.status === 'failed' && 'bg-red-500/15 text-red-400',
                log.status === 'running' && 'bg-sky-500/15 text-sky-400',
              )}
            >
              {log.status}
            </span>
            <span className="flex-1 font-mono text-xs text-fg">{log.job_name}</span>
            <span className="text-[11px] text-fg-muted">{log.items_processed} items</span>
            <span className="text-[11px] text-fg-muted">{formatDateTime(log.started_at)}</span>
          </div>
        ))}
        {(data?.items ?? []).length === 0 && (
          <p className="bg-ink-900 px-4 py-6 text-center text-sm text-fg-muted">
            No cron runs logged yet. Jobs run on their schedules while the backend is up.
          </p>
        )}
      </div>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
    </div>
  )
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-center gap-3">
      <button className="btn-ghost text-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span className="text-xs text-fg-muted">
        {page} / {totalPages}
      </span>
      <button className="btn-ghost text-xs" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  )
}
