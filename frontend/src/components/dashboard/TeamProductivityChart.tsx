import { motion } from 'framer-motion'
import { TrendingDown, TrendingUp, Users } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import type {
  TeamProductivitySeries,
  TeamProductivitySummary,
  TeamProductivityTrendPoint,
} from '../../lib/types'
import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/ui'
import { ChartContainer, ChartTooltip } from '../ui/line-chart'

const CHART_TICK = { fontSize: 10, fill: 'var(--fg-muted)' } as const

function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!match) return null
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
}

function luminance(rgb: [number, number, number]) {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
}

/** Keep team colors readable on light panels (darken pale strokes) and dark panels (lift deep strokes). */
function contrastSeriesColor(color: string, isDark: boolean): string {
  const rgb = parseHexColor(color)
  if (!rgb) return color
  const lum = luminance(rgb)
  if (!isDark && lum > 0.58) {
    const darken = (c: number) => Math.max(0, Math.round(c * 0.5))
    return `rgb(${darken(rgb[0])}, ${darken(rgb[1])}, ${darken(rgb[2])})`
  }
  if (isDark && lum < 0.32) {
    const lighten = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.4))
    return `rgb(${lighten(rgb[0])}, ${lighten(rgb[1])}, ${lighten(rgb[2])})`
  }
  return color
}

function useIsDarkTheme() {
  const theme = useUIStore((s) => s.theme)
  return useMemo(() => {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }, [theme])
}

function trendMeta(current: number, previous: number) {
  const delta = current - previous
  if (delta === 0) {
    return { label: 'No change vs prior week', tone: 'neutral' as const, pct: 0 }
  }
  const pct =
    previous > 0 ? Math.round((Math.abs(delta) / previous) * 100) : 100
  return {
    label: `${Math.abs(delta)} vs prior week`,
    tone: (delta > 0 ? 'positive' : 'negative') as 'positive' | 'negative',
    pct,
  }
}

export function TeamProductivityChart({
  series,
  trend,
  summary,
}: {
  series: TeamProductivitySeries[]
  trend: TeamProductivityTrendPoint[]
  summary: TeamProductivitySummary | null
}) {
  const isDark = useIsDarkTheme()
  const chartConfig = useMemo(() => {
    const config: Record<string, { label: string; color: string }> = {}
    for (const row of series) {
      config[row.key] = {
        label: row.name,
        color: contrastSeriesColor(row.color, isDark),
      }
    }
    return config
  }, [series, isDark])

  const chartData = useMemo(
    () =>
      trend.map((point) => ({
        label: point.label,
        ...point.counts,
      })),
    [trend],
  )

  const stats = summary ?? {
    total_completed: 0,
    previous_period_total: 0,
    active_teams: 0,
    leading_team_name: null,
    leading_team_count: 0,
    display_mode: 'team' as const,
    total_teams: 0,
    total_entities: 0,
    featured_count: 0,
    other_entities_count: 0,
  }
  const totalTrend = trendMeta(stats.total_completed, stats.previous_period_total)
  const isWorkspaceView = stats.display_mode === 'workspace'
  const scopeCaption = isWorkspaceView
    ? `Top ${stats.featured_count} of ${stats.total_entities} workspaces · ${stats.total_teams} teams org-wide`
    : stats.total_entities > stats.featured_count
      ? `Top ${stats.featured_count} of ${stats.total_entities} teams by completions`
      : `${stats.total_entities} team${stats.total_entities === 1 ? '' : 's'}`

  if (!series.length || !trend.length) {
    return (
      <p className="flex h-full items-center justify-center py-6 text-center text-xs text-fg-muted">
        No team completions in the last 7 days.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden">
      <p className="shrink-0 truncate text-[9px] font-medium" style={{ color: 'var(--fg-muted)' }} title={scopeCaption}>
        {scopeCaption}
      </p>
      <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 px-0.5">
        {series.map((item) => {
          const stroke = chartConfig[item.key]?.color ?? item.color
          return (
            <div key={item.key} className="flex min-w-0 max-w-[9rem] items-center gap-1">
              <span
                className="h-2 w-2 shrink-0 rounded-sm ring-1 ring-black/10 dark:ring-white/15"
                style={{ backgroundColor: stroke }}
              />
              <span
                className="truncate text-[10px] font-medium"
                style={{ color: 'var(--fg-secondary)' }}
                title={item.name}
              >
                {item.name}
              </span>
            </div>
          )
        })}
      </div>

      {/* min-h guards the plot: in a height-constrained card the legend/tiles are
          fixed-size, so without it flex-1 collapses and the graph vanishes. */}
      <div className="relative min-h-[88px] flex-1">
        <ChartContainer
          config={chartConfig}
          className={cn(
            'absolute inset-0 h-full w-full',
            '[&_.recharts-cartesian-grid_line]:stroke-[var(--ink-600)]',
            '[&_.recharts-cartesian-grid_line]:stroke-opacity-50',
          )}
        >
        <AreaChart data={chartData} margin={{ top: 2, right: 4, left: -18, bottom: -4 }}>
          <defs>
            {series.map((item) => {
              const stroke = chartConfig[item.key]?.color ?? item.color
              return (
                <linearGradient key={item.key} id={`prod-fill-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={isDark ? 0.4 : 0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0.03} />
                </linearGradient>
              )
            })}
          </defs>
          <CartesianGrid stroke="var(--ink-600)" strokeOpacity={0.5} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            minTickGap={16}
            tick={CHART_TICK}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={28}
            tick={CHART_TICK}
          />
          <ChartTooltip
            cursor={{ stroke: 'var(--fg-muted)', strokeOpacity: 0.45, strokeWidth: 1 }}
            contentStyle={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              boxShadow: 'none',
            }}
            wrapperStyle={{ outline: 'none', zIndex: 40 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const rows = payload
                .filter((row) => typeof row.value === 'number' && row.value > 0)
                .sort((a, b) => Number(b.value) - Number(a.value))
              if (!rows.length) return null
              return (
                <div
                  className="rounded-xl border px-3 py-2 shadow-popover"
                  style={{
                    backgroundColor: 'var(--ink-800)',
                    borderColor: 'var(--ink-700)',
                  }}
                >
                  <p className="mb-1.5 text-[11px] font-semibold" style={{ color: 'var(--fg)' }}>
                    {label}
                  </p>
                  <div className="space-y-1">
                    {rows.map((row) => {
                      const key = String(row.dataKey ?? '')
                      const meta = chartConfig[key]
                      return (
                        <div key={key} className="flex items-center justify-between gap-4 text-[11px]">
                          <span className="flex items-center gap-1.5" style={{ color: 'var(--fg-secondary)' }}>
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: meta?.color ?? row.color }}
                            />
                            {meta?.label ?? key}
                          </span>
                          <span className="font-mono font-medium tabular-nums" style={{ color: 'var(--fg)' }}>
                            {row.value} {Number(row.value) === 1 ? 'task' : 'tasks'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }}
          />
          {series.map((item) => {
            const stroke = chartConfig[item.key]?.color ?? item.color
            return (
              <Area
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.name}
                stroke={stroke}
                strokeWidth={2.5}
                fill={`url(#prod-fill-${item.key})`}
                dot={false}
                activeDot={{
                  r: 4,
                  strokeWidth: 2,
                  stroke: isDark ? 'var(--ink-900)' : '#fff',
                  fill: stroke,
                }}
                isAnimationActive
              />
            )
          })}
        </AreaChart>
        </ChartContainer>
      </div>

      <div
        className="grid shrink-0 grid-cols-3 gap-1.5 border-t pt-1.5"
        style={{ borderColor: 'var(--ink-700)' }}
      >
        <SummaryStat
          title="Tasks completed"
          value={stats.total_completed}
          hint={totalTrend.label}
          trend={totalTrend.tone}
          pct={totalTrend.pct}
        />
        <SummaryStat
          title="Active teams"
          value={stats.active_teams}
          hint={
            isWorkspaceView
              ? `across ${stats.total_teams} teams`
              : `of ${stats.total_teams} teams`
          }
          icon={<Users size={12} className="shrink-0 text-teal-500 dark:text-teal-400" />}
        />
        <SummaryStat
          title={isWorkspaceView ? 'Top workspace' : 'Top performer'}
          value={stats.leading_team_name ?? '—'}
          hint={
            stats.leading_team_count > 0
              ? `${stats.leading_team_count} tasks this week`
              : 'No completions yet'
          }
          textValue
        />
      </div>
    </div>
  )
}

function SummaryStat({
  title,
  value,
  hint,
  trend,
  pct,
  icon,
  textValue,
}: {
  title: string
  value: number | string
  hint: string
  trend?: 'positive' | 'negative' | 'neutral'
  pct?: number
  icon?: ReactNode
  textValue?: boolean
}) {
  const TrendIcon =
    trend === 'positive' ? TrendingUp : trend === 'negative' ? TrendingDown : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-w-0 rounded-lg px-2 py-1"
      style={{ backgroundColor: 'var(--ink-750)' }}
    >
      <p className="truncate text-[9px] font-medium uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
        {title}
      </p>
      <div className="mt-0.5 flex min-w-0 items-center gap-1">
        {icon}
        <span
          className={cn(
            'min-w-0 font-semibold',
            textValue ? 'truncate text-xs' : 'font-mono text-lg tabular-nums leading-none',
          )}
          style={{ color: 'var(--fg)' }}
          title={typeof value === 'string' ? value : undefined}
        >
          {value}
        </span>
        {TrendIcon && pct !== undefined && trend !== 'neutral' && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 py-px text-[9px] font-semibold',
              trend === 'positive'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
            )}
          >
            <TrendIcon size={10} />
            {pct}%
          </span>
        )}
      </div>
      <p className="mt-px truncate text-[9px] leading-tight" style={{ color: 'var(--fg-muted)' }}>
        {hint}
      </p>
    </motion.div>
  )
}
