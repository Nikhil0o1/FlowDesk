import { AlertTriangle, CheckCircle2, CircleDashed, ListTodo, Target } from 'lucide-react'

import type { GoalFolder, GoalFolderAnalytics } from '../../lib/types'
import { cn } from '../../lib/utils'
import { GoalProgressRing, goalProgressPercent } from './GoalProgressRing'

function AnalyticsStat({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string
  value: string | number
  hint?: string
  icon: typeof Target
  accent?: string
}) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">{label}</span>
        <Icon size={12} className={cn('text-fg-muted', accent)} />
      </div>
      <p className="text-lg font-semibold leading-tight text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-tight text-fg-muted">{hint}</p>}
    </div>
  )
}

/** Progress + status cards for a folder detail page */
export function FolderAnalyticsCards({
  folder,
  analytics,
}: {
  folder: GoalFolder
  analytics?: GoalFolderAnalytics | null
}) {
  const pct = goalProgressPercent(analytics?.progress ?? folder.progress)
  const active = analytics?.active_count ?? folder.active_count ?? 0
  const completed = analytics?.completed_count ?? folder.completed_count ?? 0
  const archived = analytics?.archived_count ?? folder.archived_count ?? 0
  const total = analytics?.goal_count ?? folder.goal_count ?? 0
  const notStarted = analytics?.not_started_count ?? 0
  const inProgress = analytics?.in_progress_count ?? 0
  const atRisk = analytics?.at_risk_count ?? 0

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="col-span-2 flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 lg:col-span-1">
          <GoalProgressRing progress={pct} size={40} className="text-fg" />
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">Progress</p>
            <p className="text-lg font-semibold leading-tight text-fg">{pct}%</p>
            <p className="text-[10px] leading-tight text-fg-muted">Avg of non-archived goals</p>
          </div>
        </div>
        <AnalyticsStat label="Active" value={active} icon={ListTodo} hint={`${inProgress} in progress`} />
        <AnalyticsStat
          label="Completed"
          value={completed}
          icon={CheckCircle2}
          accent="text-emerald-400"
          hint={total ? `${Math.round((completed / total) * 100)}% of folder` : undefined}
        />
        <AnalyticsStat
          label="Goals"
          value={total}
          icon={Target}
          hint={archived ? `${archived} archived` : `${notStarted} not started`}
        />
      </div>
      {(atRisk > 0 || notStarted > 0 || inProgress > 0) && (
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {atRisk > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">
              <AlertTriangle size={10} />
              {atRisk} overdue
            </span>
          )}
          {notStarted > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-ink-600 bg-ink-850 px-2 py-0.5 text-fg-muted">
              <CircleDashed size={10} />
              {notStarted} not started
            </span>
          )}
          {inProgress > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-fg-secondary">
              {inProgress} underway
            </span>
          )}
        </div>
      )}
    </div>
  )
}
