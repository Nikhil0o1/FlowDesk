import { motion } from 'framer-motion'
import {
  CheckCircle2,
  FileUp,
  LogIn,
  LogOut,
  MessageSquare,
  PlayCircle,
  Sparkles,
} from 'lucide-react'

import type {
  MyBenchmarkMetric,
  MyCollaboration,
  MyDeadlineSlice,
  MyPersonalActivityItem,
  MyPrioritySlice,
  MyProjectContributionRow,
  MyTaskTrendDay,
  MyTimeDistributionSlice,
  MyTrendPoint,
  MyWorkPattern,
} from '../../lib/types'
import { cn, formatDateTimeInTimezone, formatDuration, formatTimezoneLabel, timeAgo } from '../../lib/utils'

const DEADLINE_COLORS: Record<string, string> = {
  early: '#4CB782',
  on_time: '#2B88EE',
  late: '#E5484D',
}

const DEADLINE_LABELS: Record<string, string> = {
  early: 'Early',
  on_time: 'On time',
  late: 'Late',
}

function durationLabel(seconds: number): string {
  if (seconds <= 0) return '0'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return formatDuration(seconds)
}

export function ProductivityLineChart({ points }: { points: MyTrendPoint[] }) {
  const w = 760
  const h = 220
  const padX = 40
  const padY = 24
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const n = points.length
  const values = points.map((p) => p.value)
  const max = Math.max(...values, 1)
  const labelEvery = Math.max(1, Math.ceil(n / 7))

  const coord = (i: number, value: number) => ({
    x: padX + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW),
    y: padY + innerH - (value / max) * innerH,
  })

  const pts = points.map((p, i) => coord(i, p.value))
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaD = pts.length
    ? `${lineD} L${(padX + innerW).toFixed(1)},${padY + innerH} L${padX},${padY + innerH} Z`
    : ''

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[240px] w-full min-w-[560px]">
        <defs>
          <linearGradient id="my-prod-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const y = padY + innerH - f * innerH
          return (
            <g key={f}>
              <line x1={padX} y1={y} x2={padX + innerW} y2={y} className="stroke-white/5" strokeWidth={1} />
              <text x={6} y={y + 3} className="fill-fg-muted text-[9px]">
                {Math.round(f * max)}
              </text>
            </g>
          )
        })}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={coord(i, 0).x} y={h - 4} textAnchor="middle" className="fill-fg-muted text-[9px]">
              {new Date(`${p.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          ) : null,
        )}
        {values.some((v) => v > 0) && (
          <>
            <motion.path d={areaD} fill="url(#my-prod-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
            <motion.path
              d={lineD}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={2}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.8 }}
            />
          </>
        )}
      </svg>
      {!values.some((v) => v > 0) && (
        <p className="-mt-28 mb-20 text-center text-sm text-fg-muted">Complete tasks to see your trend.</p>
      )}
    </div>
  )
}

export function TaskTrendBars({ points }: { points: MyTaskTrendDay[] }) {
  const max = Math.max(...points.map((p) => p.completed), 1)
  return (
    <div className="flex h-48 items-end gap-2">
      {points.map((p, i) => (
        <div key={p.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="font-mono text-[10px] text-fg">{p.completed}</span>
          <motion.div
            className="w-full rounded-t-md bg-brand/60"
            initial={{ height: 0 }}
            animate={{ height: `${(p.completed / max) * 100}%` }}
            transition={{ duration: 0.5, delay: i * 0.05 }}
            style={{ minHeight: p.completed > 0 ? 4 : 0 }}
          />
          <span className="text-[10px] font-medium text-fg-muted">{p.weekday}</span>
        </div>
      ))}
    </div>
  )
}

export function DeadlineDonut({ slices, total, onTimeRate }: { slices: MyDeadlineSlice[]; total: number; onTimeRate: number }) {
  const size = 150
  const strokeWidth = 14
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  // Precompute segments so remounts / user switches always redraw correctly.
  let offset = 0
  const segments = total > 0
    ? slices
        .filter((s) => s.count > 0)
        .map((s) => {
          const fraction = s.count / total
          const dash = fraction * circumference
          const segment = { ...s, dash, offset }
          offset += dash
          return segment
        })
    : []

  const chartKey = `${total}:${slices.map((s) => `${s.label}:${s.count}`).join('|')}`

  return (
    <div className="flex items-center gap-6 max-sm:flex-col">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg key={chartKey} width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-white/5" strokeWidth={strokeWidth} />
          {segments.map((s) => (
            <motion.circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={DEADLINE_COLORS[s.label] ?? '#87909E'}
              strokeWidth={strokeWidth}
              strokeDasharray={`${Math.max(0, s.dash - 2)} ${circumference - s.dash + 2}`}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: -s.offset }}
              transition={{ duration: 0.8 }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-fg">{onTimeRate}%</span>
          <span className="text-[10px] uppercase tracking-wider text-fg-muted">On time</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DEADLINE_COLORS[s.label] }} />
            <span className="min-w-0 flex-1 text-fg-secondary">{DEADLINE_LABELS[s.label] ?? s.label}</span>
            <span className="font-mono text-fg">{s.count}</span>
          </div>
        ))}
        {total === 0 && (
          <p className="text-xs text-fg-muted">No completed tasks with deadlines in this period.</p>
        )}
      </div>
    </div>
  )
}

function activityVisual(type: string) {
  switch (type) {
    case 'login':
      return { icon: LogIn, color: 'text-emerald-400' }
    case 'logout':
      return { icon: LogOut, color: 'text-fg-muted' }
    case 'task_completed':
      return { icon: CheckCircle2, color: 'text-emerald-400' }
    case 'task_started':
      return { icon: PlayCircle, color: 'text-brand' }
    case 'comment':
      return { icon: MessageSquare, color: 'text-orange-400' }
    case 'file_upload':
      return { icon: FileUp, color: 'text-violet-400' }
    default:
      return { icon: Sparkles, color: 'text-fg-muted' }
  }
}

export function PersonalActivityTimeline({
  items,
  timeZone = 'UTC',
}: {
  items: MyPersonalActivityItem[]
  timeZone?: string
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-fg-muted">No recent activity yet.</p>
  }
  return (
    <div className="max-h-80 space-y-0.5 overflow-y-auto pr-1">
      {items.map((item) => {
        const visual = activityVisual(item.type)
        const Icon = visual.icon
        return (
          <div key={item.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
            <Icon size={15} className={cn('mt-0.5 shrink-0', visual.color)} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-fg">
                <span className="font-medium">{item.title}</span>
                {item.project_name && (
                  <span className="text-fg-muted"> · {item.project_name}</span>
                )}
              </p>
              {item.description && (
                <p className="truncate text-[11px] text-fg-secondary">{item.description}</p>
              )}
              <p className="text-[10px] text-fg-muted">
                {formatDateTimeInTimezone(item.created_at, timeZone)}
                <span className="mx-1 text-fg-muted/50">·</span>
                {timeAgo(item.created_at)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export { durationLabel }

const PROJECT_BAR_COLORS = ['#2B88EE', '#4CB782', '#F2994A', '#8C5BFF', '#E5484D', '#26B5CE', '#87909E', '#F2C94C']

export function TimeDistributionBars({ slices, totalSeconds }: { slices: MyTimeDistributionSlice[]; totalSeconds: number }) {
  if (totalSeconds === 0 || slices.length === 0) {
    return <p className="py-6 text-center text-sm text-fg-muted">Log time on project tasks to see distribution.</p>
  }
  const max = Math.max(...slices.map((s) => s.seconds), 1)
  return (
    <div className="space-y-2">
      {slices.slice(0, 8).map((s, i) => (
        <div key={s.project_id ?? s.category} className="flex items-center gap-2.5 text-sm">
          <span className="w-32 truncate text-fg-secondary" title={s.label}>{s.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-md bg-ink-800">
            <motion.div
              className="h-full rounded-md"
              style={{ backgroundColor: PROJECT_BAR_COLORS[i % PROJECT_BAR_COLORS.length] }}
              initial={{ width: 0 }}
              animate={{ width: `${(s.seconds / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.05 }}
            />
          </div>
          <span className="w-24 shrink-0 text-right font-mono text-xs text-fg">
            {formatDuration(s.seconds)} <span className="text-fg-muted">({s.percentage}%)</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function WorkPatternGrid({ pattern }: { pattern: MyWorkPattern }) {
  const tzLabel = formatTimezoneLabel(pattern.timezone || 'UTC')
  const items = [
    { label: 'Most productive day', value: pattern.most_productive_day ?? '—' },
    {
      label: 'Most productive hour',
      value:
        pattern.most_productive_hour != null
          ? `${String(pattern.most_productive_hour).padStart(2, '0')}:00`
          : '—',
    },
    { label: 'Typical start', value: pattern.avg_login_time ?? '—' },
    { label: 'Typical end', value: pattern.avg_logout_time ?? '—' },
  ]
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-fg-muted">
        Times shown in {tzLabel} — typical work window (first→last activity per day)
      </p>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{item.label}</p>
            <p className="mt-1 text-lg font-bold text-fg">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#E5484D',
  high: '#F2994A',
  medium: '#2B88EE',
  low: '#87909E',
}

export function ProjectContributionBars({ projects, total }: { projects: MyProjectContributionRow[]; total: number }) {
  if (projects.length === 0) {
    return <p className="py-6 text-center text-sm text-fg-muted">No completed tasks in this period.</p>
  }
  const max = Math.max(...projects.map((p) => p.completed_tasks), 1)
  return (
    <div className="space-y-2">
      {projects.slice(0, 8).map((p, i) => (
        <div key={p.project_id} className="flex items-center gap-2.5 text-sm">
          <span className="w-32 truncate text-fg-secondary">{p.project_name}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-md bg-ink-800">
            <motion.div
              className="h-full rounded-md bg-brand/60"
              initial={{ width: 0 }}
              animate={{ width: `${(p.completed_tasks / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.05 }}
            />
          </div>
          <span className="w-16 text-right font-mono text-xs text-fg">
            {p.percentage}% <span className="text-fg-muted">({p.completed_tasks}/{total})</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function CollaborationGrid({ data }: { data: MyCollaboration }) {
  const tiles = [
    { label: 'Comments', hint: 'Comments you posted on any task', value: data.comments },
    { label: 'Mentions', hint: 'Times others @mentioned you', value: data.mentions },
    {
      label: 'Peer comments',
      hint: 'Comments you posted on tasks you are not assigned to',
      value: data.reviews,
    },
    { label: 'Attachments', hint: 'Files you uploaded', value: data.attachments },
  ]
  return (
    <div className="grid grid-cols-4 gap-3 max-sm:grid-cols-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          title={tile.hint}
          className="rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-3 text-center"
        >
          <p className="text-2xl font-bold text-fg">{tile.value}</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            {tile.label}
          </p>
        </div>
      ))}
    </div>
  )
}

export function PriorityBars({ slices }: { slices: MyPrioritySlice[] }) {
  if (slices.every((s) => s.count === 0)) {
    return <p className="py-6 text-center text-sm text-fg-muted">No completed tasks to analyze.</p>
  }
  const max = Math.max(...slices.map((s) => s.count), 1)
  return (
    <div className="space-y-2">
      {slices.map((s, i) => (
        <div key={s.priority} className="flex items-center gap-2.5 text-sm">
          <span className="w-16 text-fg-secondary">{s.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-md bg-ink-800">
            <motion.div
              className="h-full rounded-md"
              style={{ backgroundColor: PRIORITY_COLORS[s.priority] ?? '#87909E' }}
              initial={{ width: 0 }}
              animate={{ width: `${(s.count / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.05 }}
            />
          </div>
          <span className="w-14 text-right font-mono text-xs text-fg">{s.count}</span>
        </div>
      ))}
    </div>
  )
}

function formatBenchmarkValue(key: string, value: number): string {
  if (key === 'speed') return durationLabel(value)
  return String(value)
}

export function BenchmarkCards({ metrics }: { metrics: MyBenchmarkMetric[] }) {
  return (
    <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
      {metrics.map((m) => (
        <div
          key={m.key}
          className={cn(
            'rounded-xl border px-3 py-3',
            m.improved ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-ink-700 bg-ink-800/40',
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{m.label}</p>
          <p className="mt-1 text-xl font-bold text-fg">{formatBenchmarkValue(m.key, m.current)}</p>
          <p className="mt-1 text-xs text-fg-secondary">
            Previous: {formatBenchmarkValue(m.key, m.previous)}
            {m.change_pct != null && (
              <span className={cn('ml-1 font-medium', m.improved ? 'text-emerald-400' : 'text-rose-400')}>
                ({m.change >= 0 ? '+' : ''}{m.change_pct}%)
              </span>
            )}
          </p>
        </div>
      ))}
    </div>
  )
}
