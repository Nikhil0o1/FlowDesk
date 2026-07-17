import { motion } from 'framer-motion'
import { CalendarDays, TrendingDown, TrendingUp, Zap } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import type { DeliveryVelocitySummary, DeliveryVelocityTrendPoint } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/ui'
import { ChartContainer, ChartTooltip } from '../ui/line-chart'

const CHART_TICK = { fontSize: 10, fill: 'var(--fg-muted)' } as const
const SERIES_KEY = 'completed'

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
  const pct = previous > 0 ? Math.round((Math.abs(delta) / previous) * 100) : 100
  return {
    label: `${delta > 0 ? '+' : ''}${delta} vs prior week`,
    tone: (delta > 0 ? 'positive' : 'negative') as 'positive' | 'negative',
    pct,
  }
}

export function DeliveryVelocityChart({
  trend,
  summary,
}: {
  trend: DeliveryVelocityTrendPoint[]
  summary: DeliveryVelocitySummary | null
}) {
  const isDark = useIsDarkTheme()
  const stroke = isDark ? '#a78bfa' : '#7c3aed'

  const chartConfig = useMemo(
    () => ({
      [SERIES_KEY]: { label: 'Tasks completed', color: stroke },
    }),
    [stroke],
  )

  const chartData = useMemo(
    () =>
      trend.map((point) => ({
        label: point.label,
        [SERIES_KEY]: point.completed_count,
      })),
    [trend],
  )

  const stats = summary ?? {
    total_completed: 0,
    previous_period_total: 0,
    daily_average: 0,
    best_day_label: null,
    best_day_count: 0,
  }
  const totalTrend = trendMeta(stats.total_completed, stats.previous_period_total)

  if (!trend.length) {
    return (
      <p className="flex h-full items-center justify-center py-6 text-center text-xs text-fg-muted">
        No tasks completed in the last 7 days.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden">
      <div className="relative min-h-0 flex-1">
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
            <linearGradient id="delivery-velocity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={isDark ? 0.45 : 0.3} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.03} />
            </linearGradient>
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
              const value = payload[0]?.value
              if (typeof value !== 'number') return null
              return (
                <div
                  className="rounded-xl border px-3 py-2 shadow-popover"
                  style={{
                    backgroundColor: 'var(--ink-800)',
                    borderColor: 'var(--ink-700)',
                  }}
                >
                  <p className="mb-1 text-[11px] font-semibold" style={{ color: 'var(--fg)' }}>
                    {label}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--fg-secondary)' }}>
                    <span className="font-mono font-medium tabular-nums" style={{ color: 'var(--fg)' }}>
                      {value}
                    </span>{' '}
                    {value === 1 ? 'task completed' : 'tasks completed'}
                  </p>
                </div>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey={SERIES_KEY}
            name="Tasks completed"
            stroke={stroke}
            strokeWidth={2.5}
            fill="url(#delivery-velocity-fill)"
            dot={false}
            activeDot={{
              r: 4,
              strokeWidth: 2,
              stroke: isDark ? 'var(--ink-900)' : '#fff',
              fill: stroke,
            }}
            isAnimationActive
          />
        </AreaChart>
        </ChartContainer>
      </div>

      <div
        className="grid shrink-0 grid-cols-3 gap-1.5 border-t pt-1.5"
        style={{ borderColor: 'var(--ink-700)' }}
      >
        <VelocityStat
          title="This week"
          value={stats.total_completed}
          hint={totalTrend.label}
          trend={totalTrend.tone}
          pct={totalTrend.pct}
        />
        <VelocityStat
          title="Daily average"
          value={stats.daily_average}
          hint="tasks / day (7d)"
          icon={<Zap size={12} className="shrink-0 text-violet-500 dark:text-violet-400" />}
        />
        <VelocityStat
          title="Best day"
          value={stats.best_day_label ?? '—'}
          hint={
            stats.best_day_count > 0
              ? `${stats.best_day_count} tasks completed`
              : 'No peak day yet'
          }
          icon={<CalendarDays size={12} className="shrink-0 text-violet-500 dark:text-violet-400" />}
          textValue
        />
      </div>
    </div>
  )
}

function VelocityStat({
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
