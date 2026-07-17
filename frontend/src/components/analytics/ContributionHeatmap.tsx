import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Moon, Play, Sun } from 'lucide-react'

import type { ContributionDay } from '../../lib/types'
import { useUIStore } from '../../stores/ui'
import { cn, dateKeyInTimezone, formatTimezoneLabel, normalizeTimezone } from '../../lib/utils'
import { ChartDetailBar } from './AnalyticsWidgets'

export type { ContributionDay }

const PALETTES = {
  github: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
  ocean: ['#0b1f2a', '#0e4c92', '#2a9df4', '#5ab1ff', '#b4d9ff'],
  sunset: ['#2a0b0b', '#6e1c1c', '#c23b22', '#ff6b3d', '#ff9a6c'],
} as const

type PaletteKey = keyof typeof PALETTES

interface Props {
  data: ContributionDay[]
  days: number
  timeZone?: string
  cellSize?: number
  gap?: number
  countLabel?: string
}

export function ContributionHeatmap({
  data,
  days,
  timeZone = 'UTC',
  cellSize = 12,
  gap = 3,
  countLabel = 'active users',
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const resolvedTheme = theme === 'light' ? 'light' : 'dark'
  const tz = normalizeTimezone(timeZone)
  const tzLabel = formatTimezoneLabel(timeZone)

  const [palette, setPalette] = useState<PaletteKey>('github')
  const [replayIndex, setReplayIndex] = useState<number | null>(null)
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const [pinnedDate, setPinnedDate] = useState<string | null>(null)

  const calendarDays = useMemo(
    () => generateCalendar(data, days, timeZone),
    [data, days, timeZone],
  )
  const dayByDate = useMemo(
    () => new Map(calendarDays.map((d) => [d.date, d])),
    [calendarDays],
  )
  const maxCount = Math.max(...calendarDays.map((d) => d.count), 1)
  const colors = PALETTES[palette]
  const weeks = Math.ceil(calendarDays.length / 7)
  const dates = calendarDays.map((d) => d.date)
  const activeDate = pinnedDate ?? hoveredDate
  const activeDay = activeDate ? dayByDate.get(activeDate) : undefined

  useEffect(() => {
    if (replayIndex === null) return
    if (replayIndex >= calendarDays.length) {
      setReplayIndex(null)
      return
    }
    const timer = window.setTimeout(() => setReplayIndex((v) => (v ?? 0) + 1), 8)
    return () => window.clearTimeout(timer)
  }, [replayIndex, calendarDays.length])

  useEffect(() => {
    if (!pinnedDate) return
    const onPointerDown = (event: PointerEvent) => {
      if (!mapRef.current?.contains(event.target as Node)) {
        setPinnedDate(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinnedDate(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pinnedDate])

  const exportPNG = async () => {
    if (!mapRef.current) return
    const { width, height } = mapRef.current.getBoundingClientRect()
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width)
    canvas.height = Math.ceil(height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = resolvedTheme === 'dark' ? '#111827' : '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const cells = mapRef.current.querySelectorAll<HTMLElement>('[data-heat-cell]')
    const origin = mapRef.current.getBoundingClientRect()
    cells.forEach((cell) => {
      const rect = cell.getBoundingClientRect()
      ctx.fillStyle = cell.style.backgroundColor
      ctx.fillRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height)
    })

    const link = document.createElement('a')
    link.download = 'activity-heatmap.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div
      className={cn(
        'w-full rounded-xl border p-4 transition-colors',
        resolvedTheme === 'dark'
          ? 'border-ink-700 bg-ink-900/60 text-fg'
          : 'border-gray-200 bg-white text-gray-900',
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Activity Heatmap</h3>
          <p className="text-xs text-fg-muted">
            {countLabel} over the last {days} days ({tzLabel})
          </p>
        </div>
        <div className="flex gap-1.5">
          <HeatmapToolButton onClick={() => void exportPNG()} title="Export PNG">
            <Download size={15} />
          </HeatmapToolButton>
          <HeatmapToolButton onClick={() => setReplayIndex(0)} title="Replay animation">
            <Play size={15} />
          </HeatmapToolButton>
          <HeatmapToolButton onClick={toggleTheme} title="Toggle theme">
            {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </HeatmapToolButton>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(PALETTES) as PaletteKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPalette(key)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11px] capitalize transition-colors',
              palette === key
                ? 'border-brand bg-brand-soft text-fg'
                : 'border-ink-700 text-fg-secondary hover:border-ink-600 hover:text-fg',
            )}
          >
            {key}
          </button>
        ))}
      </div>

      <ChartDetailBar
        lightSurface={resolvedTheme === 'light'}
        primary={
          activeDay
            ? `${activeDay.count} ${activeDay.count === 1 ? countLabel.replace(/s$/, '') : countLabel}`
            : null
        }
        secondary={activeDay ? formatContributionDate(activeDay.date, tz) : null}
        placeholder="Hover or click a day for details"
      />

      <div ref={mapRef} className="relative w-full overflow-x-auto overflow-y-visible">
        <MonthLabels dates={dates} cellSize={cellSize} gap={gap} timeZone={tz} />
        <div className="flex gap-2">
          <WeekdayLabels cellSize={cellSize} gap={gap} />
          <div
            style={{
              display: 'grid',
              gridTemplateRows: `repeat(7, ${cellSize}px)`,
              gridTemplateColumns: `repeat(${weeks}, ${cellSize}px)`,
              gap,
            }}
          >
            {calendarDays.map((day, index) => {
              const visible = replayIndex === null || index <= replayIndex
              const count = visible ? day.count : 0
              const intensity =
                count === 0 ? 0 : Math.min(Math.floor((count / maxCount) * 4) + 1, 4)
              const color = colors[intensity]
              const isActive = activeDate === day.date

              return (
                <div
                  key={day.date}
                  data-heat-cell
                  data-date={day.date}
                  role="button"
                  tabIndex={0}
                  aria-label={`${formatContributionDate(day.date, tz)}: ${count} ${countLabel}`}
                  className={cn(
                    'rounded-sm transition-transform hover:scale-110 focus:outline-none',
                    isActive
                      ? cn(
                          'ring-2 ring-brand',
                          resolvedTheme === 'light' ? 'ring-offset-2 ring-offset-white' : 'ring-offset-1 ring-offset-ink-900',
                        )
                      : 'focus:ring-1 focus:ring-brand',
                  )}
                  style={{ width: cellSize, height: cellSize, background: color }}
                  onMouseEnter={() => {
                    if (!pinnedDate) setHoveredDate(day.date)
                  }}
                  onMouseLeave={() => {
                    if (!pinnedDate) setHoveredDate(null)
                  }}
                  onClick={() => {
                    setPinnedDate(day.date)
                    setHoveredDate(null)
                  }}
                  onFocus={() => {
                    if (!pinnedDate) setHoveredDate(day.date)
                  }}
                  onBlur={() => {
                    if (!pinnedDate) setHoveredDate(null)
                  }}
                />
              )
            })}
          </div>
        </div>
        <Legend colors={colors} />
      </div>
    </div>
  )
}

function HeatmapToolButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-md border border-ink-700 p-1.5 text-fg-secondary transition-colors hover:border-ink-600 hover:bg-ink-800 hover:text-fg"
    >
      {children}
    </button>
  )
}

function WeekdayLabels({ cellSize, gap }: { cellSize: number; gap: number }) {
  return (
    <div
      className="text-[10px] text-fg-muted"
      style={{
        display: 'grid',
        gridTemplateRows: `repeat(7, ${cellSize}px)`,
        gap,
        width: 28,
      }}
    >
      <span />
      <span>Mon</span>
      <span />
      <span>Wed</span>
      <span />
      <span>Fri</span>
      <span />
    </div>
  )
}

function MonthLabels({
  dates,
  cellSize,
  gap,
  timeZone,
}: {
  dates: string[]
  cellSize: number
  gap: number
  timeZone: string
}) {
  const months: { label: string; col: number }[] = []
  let lastMonth = -1
  dates.forEach((date, i) => {
    const { month } = parseDateKey(date)
    if (month !== lastMonth && parseDateKey(date).day <= 7) {
      months.push({
        label: formatContributionMonth(date, normalizeTimezone(timeZone)),
        col: Math.floor(i / 7),
      })
      lastMonth = month
    }
  })

  return (
    <div
      className="mb-2 grid grid-flow-col gap-1 text-[10px] text-fg-muted"
      style={{ marginLeft: 30, gridAutoColumns: `${cellSize + gap}px` }}
    >
      {months.map((m, i) => (
        <div key={i} style={{ gridColumnStart: m.col + 1 }}>
          {m.label}
        </div>
      ))}
    </div>
  )
}

function Legend({ colors }: { colors: readonly string[] }) {
  return (
    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-fg-muted">
      <span>Less</span>
      {colors.map((color, i) => (
        <div
          key={i}
          className="h-3 w-3 rounded-sm border border-black/10"
          style={{ background: color }}
        />
      ))}
      <span>More</span>
    </div>
  )
}

function parseDateKey(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function addDaysToDateKey(date: string, offset: number): string {
  const { year, month, day } = parseDateKey(date)
  const dt = new Date(Date.UTC(year, month - 1, day + offset))
  return formatDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function weekdaySunday0(date: string): number {
  const { year, month, day } = parseDateKey(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function formatContributionDate(date: string, timeZone: string): string {
  const { year, month, day } = parseDateKey(date)
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return dt.toLocaleDateString(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatContributionMonth(date: string, timeZone: string): string {
  const { year, month, day } = parseDateKey(date)
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return dt.toLocaleDateString(undefined, { timeZone, month: 'short' })
}

function generateCalendar(
  data: ContributionDay[],
  fallbackDays: number,
  timeZone: string,
): ContributionDay[] {
  const map = new Map(data.map((d) => [d.date, d.count]))
  let startKey: string
  let endKey: string

  if (data.length > 0) {
    startKey = data[0].date
    endKey = data[data.length - 1].date
  } else {
    endKey = dateKeyInTimezone(timeZone)
    startKey = addDaysToDateKey(endKey, -(fallbackDays - 1))
  }

  // Align to full weeks (Sunday start — GitHub style).
  startKey = addDaysToDateKey(startKey, -weekdaySunday0(startKey))
  endKey = addDaysToDateKey(endKey, 6 - weekdaySunday0(endKey))

  const days: ContributionDay[] = []
  let cursor = startKey
  while (cursor <= endKey) {
    days.push({ date: cursor, count: map.get(cursor) ?? 0 })
    cursor = addDaysToDateKey(cursor, 1)
  }
  return days
}
