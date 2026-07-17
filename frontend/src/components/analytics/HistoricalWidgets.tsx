import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, Laptop, Monitor, Smartphone, Tablet } from 'lucide-react'
import { useState } from 'react'

import type {
  AnalyticsAlert,
  DeviceSlice,
  HeatmapCell,
  TrendPoint,
} from '../../lib/types'
import { cn, formatDuration, normalizeTimezone } from '../../lib/utils'

function durationSeconds(seconds: number): string {
  if (seconds <= 0) return '0m'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return formatDuration(seconds)
}

/* ------------------------------------------------------------------ */
/*  Historical trends — dual line chart with metric toggle            */
/* ------------------------------------------------------------------ */

type TrendMetric = 'active_users' | 'peak_online' | 'avg_session_duration' | 'total_sessions'

const TREND_METRICS: { key: TrendMetric; label: string; color: string }[] = [
  { key: 'active_users', label: 'Active Users', color: 'var(--brand)' },
  { key: 'peak_online', label: 'Peak Online', color: '#4CB782' },
  { key: 'total_sessions', label: 'Sessions', color: '#F2994A' },
  { key: 'avg_session_duration', label: 'Avg Session', color: '#26B5CE' },
]

export function TrendsChart({
  points,
  timeZone = 'UTC',
}: {
  points: TrendPoint[]
  timeZone?: string
}) {
  const [metric, setMetric] = useState<TrendMetric>('active_users')
  const meta = TREND_METRICS.find((m) => m.key === metric)!
  const tz = normalizeTimezone(timeZone)

  const w = 760
  const h = 240
  const padX = 40
  const padY = 24
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const n = points.length
  const values = points.map((p) => p[metric])
  const max = Math.max(...values, 1)
  const isDuration = metric === 'avg_session_duration'

  const coord = (i: number, value: number) => ({
    x: padX + (n <= 1 ? 0 : (i / (n - 1)) * innerW),
    y: padY + innerH - (value / max) * innerH,
  })

  const pts = points.map((p, i) => coord(i, p[metric]))
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaD = pts.length
    ? `${lineD} L${(padX + innerW).toFixed(1)},${padY + innerH} L${padX},${padY + innerH} Z`
    : ''
  const hasData = values.some((v) => v > 0)

  const axisLabel = (value: number) => (isDuration ? durationSeconds(value) : String(Math.round(value)))
  const labelEvery = Math.max(1, Math.ceil(n / 8))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {TREND_METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={cn(
              'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
              metric === m.key
                ? 'bg-brand-soft text-fg'
                : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-[260px] w-full min-w-[620px]">
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={meta.color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={meta.color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = padY + innerH - f * innerH
            return (
              <g key={f}>
                <line x1={padX} y1={y} x2={padX + innerW} y2={y} className="stroke-white/5" strokeWidth={1} />
                <text x={6} y={y + 3} className="fill-fg-muted text-[9px]">
                  {axisLabel(f * max)}
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

          {hasData && (
            <>
              <motion.path d={areaD} fill="url(#trend-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
              <motion.path
                d={lineD}
                fill="none"
                stroke={meta.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
            </>
          )}
        </svg>
        {!hasData && <p className="-mt-32 mb-24 text-center text-sm text-fg-muted">No historical data yet.</p>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Activity heatmap — weekday × hour                                 */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function ActivityHeatmap({ cells, maxValue }: { cells: HeatmapCell[]; maxValue: number }) {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const c of cells) {
    if (c.weekday >= 0 && c.weekday < 7 && c.hour >= 0 && c.hour < 24) {
      grid[c.weekday][c.hour] = c.value
    }
  }

  const intensity = (value: number) => {
    if (value === 0 || maxValue === 0) return 0
    return 0.15 + (value / maxValue) * 0.85
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[640px]">
        {/* Hour axis */}
        <div className="mb-1 flex pl-9">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="flex-1 text-center text-[8px] text-fg-muted">
              {h % 3 === 0 ? h.toString().padStart(2, '0') : ''}
            </div>
          ))}
        </div>
        {grid.map((row, wd) => (
          <div key={wd} className="mb-0.5 flex items-center">
            <span className="w-9 shrink-0 text-[10px] text-fg-muted">{WEEKDAYS[wd]}</span>
            <div className="flex flex-1 gap-0.5">
              {row.map((value, hr) => (
                <div
                  key={hr}
                  className="aspect-square flex-1 rounded-[2px]"
                  style={{
                    backgroundColor:
                      value === 0
                        ? 'rgba(255,255,255,0.03)'
                        : `rgba(var(--brand-rgb), ${intensity(value)})`,
                  }}
                  title={`${WEEKDAYS[wd]} ${hr.toString().padStart(2, '0')}:00 — ${value} active`}
                />
              ))}
            </div>
          </div>
        ))}
        {/* Legend */}
        <div className="mt-3 flex items-center justify-end gap-1.5 text-[9px] text-fg-muted">
          <span>Less</span>
          {[0.1, 0.35, 0.6, 0.85, 1].map((f) => (
            <span
              key={f}
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: `rgba(var(--brand-rgb), ${f})` }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Device / browser analytics — horizontal bars                      */
/* ------------------------------------------------------------------ */

function deviceIcon(name: string) {
  const n = name.toLowerCase()
  if (n.includes('mobile')) return Smartphone
  if (n.includes('tablet')) return Tablet
  if (n.includes('desktop')) return Monitor
  return Laptop
}

export function DeviceBars({
  slices,
  totalSessions,
  showIcon,
}: {
  slices: DeviceSlice[]
  totalSessions: number
  showIcon?: boolean
}) {
  if (slices.length === 0) return <p className="py-6 text-center text-sm text-fg-muted">No session data.</p>
  const max = Math.max(...slices.map((s) => s.sessions), 1)
  return (
    <div className="space-y-2">
      {slices.map((s, i) => {
        const Icon = deviceIcon(s.name)
        const pct = totalSessions > 0 ? Math.round((s.sessions / totalSessions) * 100) : 0
        return (
          <div key={s.name} className="flex items-center gap-2.5 text-sm">
            <span className="flex w-24 items-center gap-1.5 truncate text-fg-secondary">
              {showIcon && <Icon size={13} className="shrink-0 text-fg-muted" />}
              {s.name}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded-md bg-ink-800">
              <motion.div
                className="h-full rounded-md bg-brand/60"
                initial={{ width: 0 }}
                animate={{ width: `${(s.sessions / max) * 100}%` }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
              />
            </div>
            <span className="w-16 text-right font-mono text-xs text-fg">
              {s.sessions} <span className="text-fg-muted">({pct}%)</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Alerts list                                                       */
/* ------------------------------------------------------------------ */

const ALERT_VISUAL = {
  critical: { icon: AlertTriangle, className: 'border-rose-500/30 bg-rose-500/10 text-rose-400' },
  warning: { icon: AlertTriangle, className: 'border-orange-500/30 bg-orange-500/10 text-orange-400' },
  info: { icon: Info, className: 'border-ink-700 bg-ink-850/60 text-fg-secondary' },
} as const

export function AlertsList({ alerts }: { alerts: AnalyticsAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-400">
        <CheckCircle2 size={16} /> No presence anomalies detected.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const visual = ALERT_VISUAL[alert.level]
        const Icon = alert.id === 'all_clear' ? CheckCircle2 : visual.icon
        return (
          <div
            key={alert.id}
            className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5', visual.className)}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{alert.title}</p>
              <p className="text-xs text-fg-muted">{alert.description}</p>
            </div>
            {alert.count > 0 && (
              <span className="shrink-0 rounded-full bg-ink-800 px-2 py-0.5 text-xs font-mono text-fg-secondary">
                {alert.count}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
