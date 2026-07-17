import { motion, type Variants } from 'framer-motion'
import {
  AlertTriangle,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type {
  CriticalTaskRow,
  DashboardActivityRow,
  DashboardTrend,
  MemberWorkloadRow,
  OrgMember,
  ProjectPortfolioRow,
  ProjectProgressRow,
  SprintSummaryRow,
  StatusCount,
  TeamWorkloadRow,
} from '../../lib/types'
import { cn, timeAgo } from '../../lib/utils'
import { sprintPageUrl } from '../../lib/sprintRoutes'
import { Avatar } from '../ui/Avatar'

/* ------------------------------------------------------------------ */
/*  Theme-aware card class helpers                                     */
/* ------------------------------------------------------------------ */

const CARD_BG =
  'bg-white/80 dark:bg-white/[0.04] border-gray-200/70 dark:border-white/[0.06]'
const CARD_BG_GRADIENT =
  'bg-gradient-to-br from-gray-50/90 to-white/60 dark:from-white/[0.04] dark:to-white/[0.01]'
const SECTION_BG =
  'bg-gradient-to-br from-gray-50/80 to-white/50 dark:from-white/[0.03] dark:to-transparent border-gray-200/70 dark:border-white/[0.06]'
const BAR_BG = 'bg-gray-100 dark:bg-white/[0.04]'
const HOVER_BG = 'hover:bg-gray-50 dark:hover:bg-white/[0.03]'
const SHADOW = 'shadow-sm dark:shadow-[0_4px_30px_rgba(0,0,0,0.3)]'
const SHADOW_HOVER = 'hover:shadow-md dark:hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)]'
const RING_TRACK = 'stroke-gray-200 dark:stroke-white/5'

/* ------------------------------------------------------------------ */
/*  Stagger container                                                 */
/* ------------------------------------------------------------------ */

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 28 } },
}

/* ------------------------------------------------------------------ */
/*  Glassmorphism KPI Card — with integrated micro-viz                */
/* ------------------------------------------------------------------ */

export function GlassKpi({
  label,
  value,
  trend,
  accent = '#8C5BFF',
  onClick,
  sparkData,
}: {
  label: string
  value: number | string
  trend?: DashboardTrend
  accent?: string
  onClick?: () => void
  sparkData?: number[]
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group relative flex h-full min-h-[84px] flex-col overflow-hidden rounded-xl border p-3',
        CARD_BG_GRADIENT,
        'backdrop-blur-xl',
        SHADOW,
        'transition-all duration-300',
        SHADOW_HOVER,
        onClick && 'cursor-pointer',
      )}
    >
      {/* Glow accent */}
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10 blur-2xl dark:opacity-20"
        style={{ backgroundColor: accent }}
      />

      <p className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">{label}</p>

      <div className="mt-1 flex items-end justify-between">
        <AnimatedNumber value={value} accent={accent} />
        {sparkData && sparkData.length > 1 && (
          <MiniSparkline data={sparkData} color={accent} />
        )}
      </div>

      <div className="mt-auto flex items-center gap-1 pt-2">
        {trend ? (
          <span
            className={cn(
              'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
              trend.tone === 'positive' && 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
              trend.tone === 'negative' && 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
              trend.tone === 'neutral' && 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-fg-muted',
            )}
          >
            {trend.direction === 'up' && <TrendingUp size={10} />}
            {trend.direction === 'down' && <TrendingDown size={10} />}
            {trend.direction === 'flat' && <Minus size={10} />}
            {trend.label}
          </span>
        ) : (
          <span className="h-[22px]" /> /* Spacer to match trend pill height */
        )}
      </div>

      {onClick && (
        <ArrowUpRight
          size={13}
          className="absolute right-3 top-3 text-gray-400/60 transition-colors group-hover:text-gray-500 dark:text-fg-muted/40 dark:group-hover:text-fg-muted"
        />
      )}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Animated number counter                                           */
/* ------------------------------------------------------------------ */

function AnimatedNumber({ value, accent }: { value: number | string; accent: string }) {
  const numericValue = typeof value === 'number' ? value : parseInt(value, 10)
  const isNumeric = !isNaN(numericValue) && typeof value === 'number'
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!isNumeric) return
    const start = display
    const end = numericValue
    const duration = 600
    const startTime = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + (end - start) * eased))
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [numericValue])

  return (
    <span className="text-xl font-bold tracking-tight" style={{ color: accent }}>
      {isNumeric ? display : value}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Mini sparkline (SVG)                                              */
/* ------------------------------------------------------------------ */

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const w = 64
  const h = 28
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - ((v - min) / range) * h,
  }))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const fillD = `${pathD} L${w},${h} L0,${h} Z`
  const gradId = `sg-${color.replace('#', '')}-${data.length}`

  return (
    <svg width={w} height={h} className="shrink-0 opacity-70">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={fillD}
        fill={`url(#${gradId})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      />
      <motion.path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: 'easeOut' }}
      />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Scrollable panel body (internal scroll — dashboard page stays fixed) */
/* ------------------------------------------------------------------ */

export function DashboardScrollArea({
  children,
  className,
  axis = 'y',
}: {
  children: React.ReactNode
  className?: string
  axis?: 'y' | 'x' | 'both'
}) {
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overscroll-contain',
        axis === 'y' && 'overflow-y-auto overflow-x-hidden',
        axis === 'x' && 'overflow-x-auto overflow-y-hidden',
        axis === 'both' && 'overflow-auto',
        className,
      )}
    >
      {children}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/*  Radial progress ring (animated SVG)                               */
/* ------------------------------------------------------------------ */

export function ProgressRing({
  percent,
  size = 100,
  strokeWidth = 8,
  color = '#8C5BFF',
  label,
  sublabel,
  showCenterLabel = true,
}: {
  percent: number
  size?: number
  strokeWidth?: number
  color?: string
  label?: string
  sublabel?: string
  /** Hide the centered % label (use for compact rings that show stats beside them). */
  showCenterLabel?: boolean
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const centerLabelSize =
    size <= 40 ? 'text-[8px]' : size <= 52 ? 'text-[10px]' : 'text-lg'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={RING_TRACK}
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - (percent / 100) * circumference }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 6px ${color}60)` }}
        />
      </svg>
      {showCenterLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('font-semibold tabular-nums leading-none text-fg', centerLabelSize)}>
            {percent}%
          </span>
          {label && <span className="text-[10px] text-fg-muted">{label}</span>}
          {sublabel && <span className="text-[9px] text-fg-muted">{sublabel}</span>}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Arc-based multi-segment donut (replaces plain donut)              */
/* ------------------------------------------------------------------ */

export function GlowDonut({
  breakdown,
  total,
  size = 140,
}: {
  breakdown: StatusCount[]
  total: number
  size?: number
}) {
  const strokeWidth = 14
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  if (total === 0) return <p className="py-4 text-center text-sm text-fg-muted">No tasks.</p>

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {breakdown.map((s) => {
            const fraction = s.count / total
            const dash = fraction * circumference
            const gap = 3
            const el = (
              <motion.circle
                key={s.name}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0, dash - gap)} ${circumference - dash + gap}`}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: -offset }}
                transition={{ duration: 1, ease: 'easeOut', delay: 0.1 }}
                style={{ filter: `drop-shadow(0 0 4px ${s.color}40)` }}
              />
            )
            offset += dash
            return el
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-fg">{total}</span>
          <span className="text-[10px] text-fg-muted">open</span>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {breakdown.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color, boxShadow: `0 0 6px ${s.color}50` }}
            />
            <span className="min-w-0 flex-1 truncate text-fg-secondary">{s.name}</span>
            <span className="font-mono text-fg">{s.count}</span>
            <span className="text-fg-muted">
              {total > 0 ? Math.round((s.count / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Horizontal bar chart (animated)                                   */
/* ------------------------------------------------------------------ */

export function HorizontalBars({
  items,
  color = '#8C5BFF',
}: {
  items: { label: string; value: number; color?: string; id?: string }[]
  color?: string
}) {
  const max = Math.max(...items.map((i) => i.value), 1)
  const navigate = useNavigate()

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <motion.div
          key={item.id ?? item.label}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05, type: 'spring', stiffness: 200 }}
          className={cn('flex items-center gap-2.5', item.id && 'cursor-pointer')}
          onClick={() => item.id && navigate(`/app/projects/${item.id}`)}
        >
          <span className="w-20 truncate text-xs text-fg-secondary">{item.label}</span>
          <div className={cn('h-4 flex-1 overflow-hidden rounded-md', BAR_BG)}>
            <motion.div
              className="h-full rounded-lg"
              style={{
                backgroundColor: item.color ?? color,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15)`,
              }}
              initial={{ width: 0 }}
              animate={{ width: `${(item.value / max) * 100}%` }}
              transition={{ duration: 0.8, delay: i * 0.05, ease: 'easeOut' }}
            />
          </div>
          <span className="w-6 text-right font-mono text-xs text-fg">{item.value}</span>
        </motion.div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Project progress compact (mini bars)                              */
/* ------------------------------------------------------------------ */

export function ProjectProgressCompact({
  rows,
}: {
  rows: ProjectProgressRow[]
  total?: number
}) {
  const navigate = useNavigate()
  if (rows.length === 0) return <p className="py-2 text-center text-xs text-fg-muted">No projects.</p>

  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <motion.button
          key={r.project_id}
          onClick={() => navigate(`/app/projects/${r.project_id}`)}
          className={cn('group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left', HOVER_BG)}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04 }}
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
            style={{ backgroundColor: r.color }}
          >
            {r.name[0]?.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-fg">{r.name}</span>
          <span className={cn('h-1.5 w-16 overflow-hidden rounded-full', BAR_BG)}>
            <motion.span
              className="block h-full rounded-full"
              style={{ backgroundColor: r.color }}
              initial={{ width: 0 }}
              animate={{ width: `${r.progress_percent}%` }}
              transition={{ duration: 0.7, delay: i * 0.04 }}
            />
          </span>
          <span className="w-7 text-right font-mono text-[10px] text-fg-muted">{r.progress_percent}%</span>
        </motion.button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Critical tasks compact                                            */
/* ------------------------------------------------------------------ */

export function CriticalTasksCompact({
  tasks,
  total,
}: {
  tasks: CriticalTaskRow[]
  total?: number
}) {
  const navigate = useNavigate()
  if (tasks.length === 0) return <p className="py-2 text-center text-xs text-fg-muted">All clear.</p>

  const hiddenCount = total !== undefined && total > tasks.length ? total - tasks.length : 0

  return (
    <div className="space-y-0.5">
      {tasks.map((t, i) => (
        <motion.button
          key={t.task_id}
          onClick={() => navigate(`/app/tasks/${t.task_id}`)}
          className={cn('flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left', HOVER_BG)}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04 }}
        >
          <span
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded',
              t.status_kind === 'overdue' && 'bg-rose-500/20 text-rose-500 dark:text-rose-400',
              t.status_kind === 'critical' && 'bg-red-500/20 text-red-500 dark:text-red-400',
              t.status_kind === 'due_soon' && 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
            )}
          >
            <AlertTriangle size={9} />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-fg">
            <span className="text-fg-muted">{t.task_ref}</span>{' '}
            {t.title}
          </span>
          {t.due_date && (
            <span className="shrink-0 text-[10px] text-fg-muted">
              {new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </motion.button>
      ))}
      {hiddenCount > 0 && (
        <p className="px-1.5 pt-0.5 text-[10px] text-fg-muted">+{hiddenCount} more</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Organization members compact (Org Owner dashboard)                */
/* ------------------------------------------------------------------ */

const ORG_ROLE_LABELS: Record<string, string> = {
  owner: 'Organization Owner',
  admin: 'Organization Admin',
  member: 'Organization Member',
}

const ORG_ROLE_ORDER: Record<string, number> = {
  owner: 0,
  admin: 1,
  member: 2,
}

function orgRoleLabel(role: string) {
  return ORG_ROLE_LABELS[role] ?? role.replace(/_/g, ' ')
}

function orgRoleTextClass(role: string) {
  if (role === 'owner') {
    return 'text-violet-600 dark:text-violet-300'
  }
  if (role === 'admin') {
    return 'text-teal-600 dark:text-teal-300'
  }
  return 'text-gray-500 dark:text-fg-muted'
}

export function OrgMembersCompact({
  members,
  onViewAll,
}: {
  members: OrgMember[]
  onViewAll?: () => void
}) {
  if (members.length === 0) {
    return <p className="py-3 text-center text-xs text-fg-muted">No members yet.</p>
  }

  const sorted = [...members].sort(
    (a, b) => (ORG_ROLE_ORDER[a.role] ?? 9) - (ORG_ROLE_ORDER[b.role] ?? 9),
  )

  return (
    <div className="space-y-0.5">
      {sorted.map((m, i) => {
        const name = m.user?.full_name || m.user?.email || 'Unknown'
        return (
          <motion.button
            key={m.id}
            type="button"
            onClick={onViewAll}
            className={cn('flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left', HOVER_BG)}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            whileHover={{ x: 2 }}
          >
            <Avatar
              name={name}
              src={m.user?.avatar_url}
              color={m.user?.avatar_color}
              size={28}
              userId={m.user_id}
              showPresence
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-fg">{name}</p>
              <p className={cn('mt-0.5 truncate text-[10px] font-medium', orgRoleTextClass(m.role))}>
                {orgRoleLabel(m.role)}
              </p>
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Activity feed compact                                             */
/* ------------------------------------------------------------------ */

export function ActivityFeedCompact({
  activities,
}: {
  activities: DashboardActivityRow[]
}) {
  if (activities.length === 0)
    return <p className="py-2 text-center text-xs text-fg-muted">No recent activity.</p>

  return (
    <div className="space-y-0.5">
      {activities.map((a, i) => (
        <motion.div
          key={a.id}
          className="flex items-start gap-2 rounded-lg px-1.5 py-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.05 }}
        >
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ backgroundColor: a.actor?.avatar_color ?? '#6366f1' }}
          >
            {a.actor?.full_name?.[0]?.toUpperCase() ?? '?'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-fg">
              <span className="font-medium">{a.actor?.full_name ?? 'System'}</span>{' '}
              <span className="text-fg-secondary">{a.summary}</span>
            </p>
            <p className="text-[10px] text-fg-muted">{timeAgo(a.created_at)}</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Member workload compact (bar chart style)                         */
/* ------------------------------------------------------------------ */

export function MemberWorkloadCompact({
  members,
}: {
  members: MemberWorkloadRow[]
}) {
  if (members.length === 0)
    return <p className="py-2 text-center text-xs text-fg-muted">No data.</p>

  const max = Math.max(...members.map((m) => m.open_tasks + m.completed_tasks), 1)

  return (
    <div className="space-y-1">
      {members.map((m, i) => (
        <motion.div
          key={m.user.id}
          className="flex items-center gap-2"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04 }}
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ backgroundColor: m.user.avatar_color ?? '#6366f1' }}
          >
            {m.user.full_name?.[0]?.toUpperCase() ?? '?'}
          </span>
          <span className="w-16 truncate text-[11px] text-fg-secondary">{m.user.full_name?.split(' ')[0] || 'User'}</span>
          <div className={cn('flex h-4 flex-1 overflow-hidden rounded-md', BAR_BG)}>
            <motion.div
              className="h-full bg-brand/60"
              initial={{ width: 0 }}
              animate={{ width: `${(m.open_tasks / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.04 }}
            />
            <motion.div
              className="h-full bg-emerald-500/60"
              initial={{ width: 0 }}
              animate={{ width: `${(m.completed_tasks / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.04 + 0.1 }}
            />
          </div>
          <span className="w-5 text-right font-mono text-[10px] text-fg-muted">{m.open_tasks}</span>
        </motion.div>
      ))}
      <div className="flex gap-3 pt-0.5 text-[9px] text-fg-muted">
        <span><span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-sm bg-brand/60" />Open</span>
        <span><span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-sm bg-emerald-500/60" />Done (7d)</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sprint pill compact                                               */
/* ------------------------------------------------------------------ */

export function SprintPills({ sprints }: { sprints: SprintSummaryRow[] }) {
  const navigate = useNavigate()

  if (sprints.length === 0) return <p className="py-2 text-center text-xs text-fg-muted">No active sprints.</p>

  return (
    <div className="flex flex-col gap-2 py-0.5">
      {sprints.map((s) => {
        const pct =
          s.task_count > 0 ? Math.round((s.completed_tasks / s.task_count) * 100) : 0
        return (
          <button
            key={s.sprint_id}
            type="button"
            onClick={() => navigate(sprintPageUrl({ sprintId: s.sprint_id }))}
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
              CARD_BG,
              'hover:border-ink-600 hover:bg-ink-800/60',
            )}
          >
            <ProgressRing percent={pct} size={44} strokeWidth={4} color="#8C5BFF" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-fg">{s.name}</p>
              <p className="text-[10px] text-fg-muted">
                {s.completed_tasks}/{s.task_count} tasks
              </p>
              {s.start_date && s.end_date && (
                <p className="truncate text-[10px] text-fg-muted/80">
                  {s.start_date} → {s.end_date}
                </p>
              )}
            </div>
            <ArrowUpRight
              size={12}
              className="shrink-0 text-fg-muted/50 transition-colors group-hover:text-fg-muted"
            />
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Team workload bars (org admin)                                    */
/* ------------------------------------------------------------------ */

export function TeamWorkloadCompact({ rows }: { rows: TeamWorkloadRow[] }) {
  if (rows.length === 0) return <p className="py-3 text-center text-xs text-fg-muted">No teams.</p>

  const max = Math.max(...rows.map((t) => t.open_tasks + t.completed_tasks), 1)

  return (
    <div className="space-y-1.5">
      {rows.map((t, i) => {
        const onTrack = t.open_tasks - t.overdue_tasks
        const tooltip = `${t.name} — ${t.member_count} member${t.member_count === 1 ? '' : 's'} · ${t.open_tasks} open (${t.overdue_tasks} overdue) · ${t.completed_tasks} done in last 7 days`
        return (
          <motion.div
            key={t.team_id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: Math.min(i * 0.03, 0.3) }}
            className="flex items-center gap-2"
            title={tooltip}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="w-20 truncate text-[11px] text-fg">{t.name}</span>
            <div className={cn('flex h-3 flex-1 overflow-hidden rounded-full', BAR_BG)}>
              <motion.span
                className="h-full bg-brand/60"
                initial={{ width: 0 }}
                animate={{ width: `${(onTrack / max) * 100}%` }}
                transition={{ duration: 0.6, delay: Math.min(i * 0.03, 0.3) }}
              />
              <motion.span
                className="h-full bg-rose-500/70"
                initial={{ width: 0 }}
                animate={{ width: `${(t.overdue_tasks / max) * 100}%` }}
                transition={{ duration: 0.6, delay: Math.min(i * 0.03, 0.3) + 0.05 }}
              />
              <motion.span
                className="h-full bg-emerald-500/60"
                initial={{ width: 0 }}
                animate={{ width: `${(t.completed_tasks / max) * 100}%` }}
                transition={{ duration: 0.6, delay: Math.min(i * 0.03, 0.3) + 0.1 }}
              />
            </div>
            <span className="w-6 shrink-0 text-right font-mono text-[10px] text-fg-muted">
              {t.open_tasks}
            </span>
          </motion.div>
        )
      })}
      <div className="flex gap-3 pt-0.5 text-[9px] text-fg-muted">
        <span><span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-sm bg-brand/60" />Open</span>
        <span><span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-sm bg-rose-500/70" />Overdue</span>
        <span><span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-sm bg-emerald-500/60" />Done (7d)</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Portfolio health list (org owner)                                 */
/* ------------------------------------------------------------------ */

export function PortfolioHealthList({ projects }: { projects: ProjectPortfolioRow[] }) {
  const navigate = useNavigate()

  if (projects.length === 0) {
    return <p className="py-2 text-center text-xs text-fg-muted">No projects.</p>
  }

  return (
    <div className="space-y-0.5">
      {projects.map((project) => (
        <motion.button
          key={project.project_id}
          type="button"
          onClick={() => navigate(`/app/projects/${project.project_id}`)}
          className={cn('flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left', HOVER_BG)}
          whileHover={{ x: 2 }}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg" title={project.name}>
            {project.name}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold',
              project.health === 'healthy'
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                : 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
            )}
          >
            {project.health === 'healthy' ? 'OK' : 'Risk'}
          </span>
        </motion.button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Section header with glass effect                                  */
/* ------------------------------------------------------------------ */

export function SectionGlass({
  icon,
  title,
  className,
  fill,
  children,
}: {
  icon: React.ReactNode
  title: string
  className?: string
  fill?: boolean
  children: React.ReactNode
}) {
  return (
    <motion.div
      variants={fadeUp}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border',
        SECTION_BG,
        'backdrop-blur-md',
        fill ? 'min-h-0 p-3' : 'rounded-2xl p-4',
        className,
      )}
    >
      <div className={cn('flex shrink-0 items-center gap-1.5', fill ? 'mb-2' : 'mb-3')}>
        <span className="text-fg-muted">{icon}</span>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
      </div>
      <div className={cn(fill && 'flex min-h-0 flex-1 flex-col overflow-hidden')}>{children}</div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  Shared card background class export for dashboards                */
/* ------------------------------------------------------------------ */

export { CARD_BG, CARD_BG_GRADIENT, SECTION_BG, BAR_BG, HOVER_BG, SHADOW, SHADOW_HOVER, RING_TRACK }
