import { motion } from 'framer-motion'
import {
  Activity,
  LogIn,
  LogOut,
  Moon,
  MinusCircle,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { Avatar } from '../ui/Avatar'
import type {
  AnalyticsStatusSlice,
  AnalyticsTimelinePoint,
  PresenceActivityItem,
  PresenceStatus,
} from '../../lib/types'
import { useUIStore } from '../../stores/ui'
import { cn, formatDuration, formatHourInTimezone, normalizeTimezone, timeAgo } from '../../lib/utils'

export const STATUS_META: Record<PresenceStatus, { label: string; color: string; dot: string }> = {
  online: { label: 'Online', color: '#4CB782', dot: 'bg-emerald-400' },
  busy: { label: 'Busy', color: '#E5484D', dot: 'bg-red-400' },
  away: { label: 'Away', color: '#F2994A', dot: 'bg-orange-400' },
  offline: { label: 'Offline', color: '#87909E', dot: 'bg-gray-400' },
}

/** Fixed in-card detail strip — keeps hover/click readouts inside the widget. */
export function ChartDetailBar({
  primary,
  secondary,
  placeholder = 'Hover or click a point for details',
  lightSurface = false,
}: {
  primary?: string | null
  secondary?: string | null
  placeholder?: string
  lightSurface?: boolean
}) {
  const appTheme = useUIStore((s) => s.theme)
  const light = lightSurface || appTheme === 'light'
  const hasSelection = Boolean(primary)

  return (
    <div
      className={cn(
        'mb-3 flex min-h-9 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs',
        light
          ? 'border-gray-200 bg-gray-50 text-gray-900'
          : 'border-ink-700 bg-ink-850/60 text-fg',
      )}
    >
      {hasSelection ? (
        <>
          <span className="font-semibold">{primary}</span>
          {secondary ? (
            <span className={light ? 'text-gray-600' : 'text-fg-secondary'}>{secondary}</span>
          ) : null}
        </>
      ) : (
        <span className={light ? 'text-gray-500' : 'text-fg-muted'}>{placeholder}</span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Status pill                                                        */
/* ------------------------------------------------------------------ */

export function StatusPill({ status }: { status: PresenceStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Online activity timeline (area + line)                            */
/* ------------------------------------------------------------------ */

export function TimelineChart({
  points,
  timeZone = 'UTC',
}: {
  points: AnalyticsTimelinePoint[]
  timeZone?: string
}) {
  const tz = normalizeTimezone(timeZone)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)

  const w = 720
  const h = 200
  const padX = 28
  const padY = 20
  const innerW = w - padX * 2
  const innerH = h - padY * 2
  const max = Math.max(...points.map((p) => p.online), 1)
  const n = points.length

  const coord = (i: number, value: number) => ({
    x: padX + (n <= 1 ? 0 : (i / (n - 1)) * innerW),
    y: padY + innerH - (value / max) * innerH,
  })

  const linePts = points.map((p, i) => coord(i, p.online))
  const lineD = linePts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaD = `${lineD} L${(padX + innerW).toFixed(1)},${padY + innerH} L${padX},${padY + innerH} Z`
  const hasData = points.some((p) => p.online > 0)
  const activeIndex = pinnedIndex ?? hoveredIndex
  const activePoint = activeIndex !== null ? points[activeIndex] : null

  const selectPoint = (index: number) => {
    setHoveredIndex(index)
  }

  const pinPoint = (index: number) => {
    setPinnedIndex(index)
    setHoveredIndex(null)
  }

  const clearSelection = () => {
    setHoveredIndex(null)
    if (!pinnedIndex) return
  }

  useEffect(() => {
    if (pinnedIndex === null) return
    const onPointerDown = (event: PointerEvent) => {
      const root = document.getElementById('timeline-chart-root')
      if (root && !root.contains(event.target as Node)) {
        setPinnedIndex(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinnedIndex(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pinnedIndex])

  return (
    <div id="timeline-chart-root" className="relative w-full overflow-x-auto">
      <ChartDetailBar
        primary={
          activePoint
            ? `${activePoint.online} ${activePoint.online === 1 ? 'user' : 'users'} online`
            : null
        }
        secondary={
          activePoint
            ? new Date(activePoint.bucket).toLocaleString(undefined, {
                timeZone: tz,
                hour: 'numeric',
                minute: '2-digit',
              })
            : null
        }
        placeholder="Hover or click an hour for details"
      />
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[220px] w-full min-w-[560px]">
        <defs>
          <linearGradient id="tl-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padY + innerH - f * innerH
          return (
            <g key={f}>
              <line x1={padX} y1={y} x2={padX + innerW} y2={y} className="stroke-white/5" strokeWidth={1} />
              <text x={4} y={y + 3} className="fill-fg-muted text-[9px]">
                {Math.round(f * max)}
              </text>
            </g>
          )
        })}

        {/* X-axis hour labels every 3 hours */}
        {points.map((p, i) =>
          i % 3 === 0 ? (
            <text key={i} x={coord(i, 0).x} y={h - 4} textAnchor="middle" className="fill-fg-muted text-[9px]">
              {formatHourInTimezone(p.bucket, timeZone)}
            </text>
          ) : null,
        )}

        {hasData && (
          <>
            <motion.path
              d={areaD}
              fill="url(#tl-fill)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
            />
            <motion.path
              d={lineD}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
            {linePts.map((p, i) =>
              points[i].online > 0 ? (
                <circle
                  key={`dot-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={activeIndex === i ? 4 : 2.5}
                  fill="var(--brand)"
                  className="pointer-events-none"
                />
              ) : null,
            )}
            {linePts.map((p, i) => (
              <circle
                key={`hit-${i}`}
                cx={p.x}
                cy={p.y}
                r={12}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => {
                  if (pinnedIndex === null) selectPoint(i)
                }}
                onMouseLeave={() => {
                  if (pinnedIndex === null) setHoveredIndex(null)
                }}
                onClick={() => pinPoint(i)}
              />
            ))}
          </>
        )}
      </svg>

      {!hasData && (
        <p className="-mt-24 mb-16 text-center text-sm text-fg-muted">No online activity recorded.</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Status distribution donut                                         */
/* ------------------------------------------------------------------ */

export function StatusDonut({
  slices,
  total,
  size = 160,
}: {
  slices: AnalyticsStatusSlice[]
  total: number
  size?: number
}) {
  const strokeWidth = 16
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex items-center gap-6 max-sm:flex-col">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-white/5"
            strokeWidth={strokeWidth}
          />
          {total > 0 &&
            slices.map((s) => {
              if (s.count === 0) return null
              const fraction = s.count / total
              const dash = fraction * circumference
              const el = (
                <motion.circle
                  key={s.status}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={STATUS_META[s.status].color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${Math.max(0, dash - 2)} ${circumference - dash + 2}`}
                  initial={{ strokeDashoffset: circumference }}
                  animate={{ strokeDashoffset: -offset }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              )
              offset += dash
              return el
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-fg">{total}</span>
          <span className="text-[10px] uppercase tracking-wider text-fg-muted">Members</span>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        {slices.map((s) => (
          <div key={s.status} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: STATUS_META[s.status].color }}
            />
            <span className="min-w-0 flex-1 truncate text-fg-secondary">{STATUS_META[s.status].label}</span>
            <span className="font-mono text-fg">{s.count}</span>
            <span className="w-9 text-right text-fg-muted">
              {total > 0 ? Math.round((s.count / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Recent presence activity feed                                     */
/* ------------------------------------------------------------------ */

function eventVisual(eventType: string) {
  switch (eventType) {
    case 'login':
      return { icon: LogIn, color: 'text-emerald-400', label: 'signed in' }
    case 'logout':
      return { icon: LogOut, color: 'text-gray-400', label: 'signed out' }
    case 'away':
      return { icon: Moon, color: 'text-orange-400', label: 'went away' }
    case 'busy':
      return { icon: MinusCircle, color: 'text-red-400', label: 'set busy' }
    case 'online':
      return { icon: Activity, color: 'text-emerald-400', label: 'came online' }
    default:
      return { icon: RefreshCw, color: 'text-fg-muted', label: 'changed status' }
  }
}

export function ActivityFeed({ items }: { items: PresenceActivityItem[] }) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-fg-muted">No recent presence activity.</p>
  }
  return (
    <div className="max-h-80 space-y-0.5 overflow-y-auto pr-1">
      {items.map((item) => {
        const visual = eventVisual(item.event_type)
        const Icon = visual.icon
        const name = item.user?.full_name || item.user?.email || 'Someone'
        const detail =
          item.event_type === 'status_change' && item.old_status && item.new_status
            ? `changed from ${item.old_status} to ${item.new_status}`
            : visual.label
        return (
          <div key={item.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
            <Avatar
              name={name}
              src={item.user?.avatar_url}
              color={item.user?.avatar_color}
              size={26}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-fg">
                <span className="font-medium">{name}</span>{' '}
                <span className="text-fg-secondary">{detail}</span>
              </p>
              <p className="text-[10px] text-fg-muted">{timeAgo(item.created_at)}</p>
            </div>
            <Icon size={14} className={cn('shrink-0', visual.color)} />
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Session duration cell helper                                      */
/* ------------------------------------------------------------------ */

export function durationLabel(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  return formatDuration(seconds)
}
