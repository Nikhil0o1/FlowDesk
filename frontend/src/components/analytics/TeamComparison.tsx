import { motion } from 'framer-motion'
import { useState } from 'react'

import { useAnalyticsTeamActivity } from '../../lib/queries'
import type { TeamActivityRow } from '../../lib/types'
import { CenteredSpinner } from '../ui/Spinner'
import { STATUS_META } from './AnalyticsWidgets'

const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: 'team', label: 'Teams' },
  { value: 'workspace', label: 'Workspaces' },
  { value: 'space', label: 'Spaces' },
  { value: 'project', label: 'Projects' },
]

function StackedBar({ row }: { row: TeamActivityRow }) {
  const total = row.member_count || 1
  const segments = (['online', 'busy', 'away', 'offline'] as const).map((s) => ({
    status: s,
    value: row[s],
  }))
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-800">
      {segments.map((seg) =>
        seg.value > 0 ? (
          <motion.div
            key={seg.status}
            className="h-full"
            style={{ backgroundColor: STATUS_META[seg.status].color }}
            initial={{ width: 0 }}
            animate={{ width: `${(seg.value / total) * 100}%` }}
            transition={{ duration: 0.6 }}
            title={`${STATUS_META[seg.status].label}: ${seg.value}`}
          />
        ) : null,
      )}
    </div>
  )
}

export function TeamComparison({ orgId, tail }: { orgId: string | undefined; tail: string }) {
  const [groupBy, setGroupBy] = useState('team')
  const query = useAnalyticsTeamActivity(orgId, groupBy, tail)
  const rows = query.data?.rows ?? []

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setGroupBy(opt.value)}
              className={
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ' +
                (groupBy === opt.value
                  ? 'bg-brand-soft text-fg'
                  : 'text-fg-secondary hover:bg-ink-750 hover:text-fg')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-fg-muted">
          {(['online', 'busy', 'away', 'offline'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: STATUS_META[s].color }}
              />
              {STATUS_META[s].label}
            </span>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <div className="py-10">
          <CenteredSpinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No {groupBy}s to compare.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Members</th>
                <th className="w-[35%] px-3 py-2 font-semibold">Presence</th>
                <th className="px-3 py-2 text-right font-semibold">Online</th>
                <th className="px-3 py-2 text-right font-semibold">Active Today</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-800/70">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color ?? '#87909E' }}
                      />
                      <span className="truncate font-medium text-fg">{row.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-fg-secondary">{row.member_count}</td>
                  <td className="px-3 py-2.5">
                    <StackedBar row={row} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-emerald-400">{row.online}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-fg-secondary">
                    {row.active_today}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
