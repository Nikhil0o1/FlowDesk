import { motion } from 'framer-motion'
import {
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  Clock,
  GitBranch,
  LineChart,
  MessageSquare,
  Paperclip,
  PieChart,
  Target,
  Timer,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import { useState } from 'react'

import {
  BenchmarkCards,
  CollaborationGrid,
  DeadlineDonut,
  durationLabel,
  PersonalActivityTimeline,
  PriorityBars,
  ProductivityLineChart,
  ProjectContributionBars,
  TaskTrendBars,
  TimeDistributionBars,
  WorkPatternGrid,
} from '../../components/my-analytics/MyAnalyticsWidgets'
import { GlassKpi, DashboardScrollArea, stagger } from '../../components/dashboard/DashboardWidgets'
import { CenteredSpinner } from '../../components/ui/Spinner'
import {
  useMyAnalyticsOverview,
  useMyBenchmarks,
  useMyCollaboration,
  useMyDeadlinePerformance,
  useMyPersonalActivity,
  useMyPriorityAnalysis,
  useMyProductivityTrend,
  useMyProjectContribution,
  useMyTaskTrends,
  useMyTimeDistribution,
  useMyWorkPattern,
} from '../../lib/queries'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'

function Panel({
  icon,
  title,
  subtitle,
  action,
  className,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('rounded-2xl border border-ink-700 bg-ink-850/50 p-4 backdrop-blur-md', className)}>
      <div className="mb-3 flex items-center gap-1.5">
        <span className="text-fg-muted">{icon}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
        {subtitle && <span className="ml-1 truncate text-[11px] text-fg-muted/70">— {subtitle}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}

export default function MyAnalyticsPage() {
  const [prodPeriod, setProdPeriod] = useState<'week' | 'month'>('week')
  const [benchPeriod, setBenchPeriod] = useState<'week' | 'month'>('week')
  const profileTimezone = useAuthStore((s) => s.user?.profile?.timezone || 'UTC')

  const overview = useMyAnalyticsOverview()
  const productivity = useMyProductivityTrend(prodPeriod)
  const taskTrends = useMyTaskTrends()
  const deadline = useMyDeadlinePerformance(90)
  const activity = useMyPersonalActivity(50)
  const workPattern = useMyWorkPattern(30)
  const timeDistribution = useMyTimeDistribution(30)
  const projectContribution = useMyProjectContribution(30)
  const collaboration = useMyCollaboration(30)
  const priority = useMyPriorityAnalysis(30)
  const benchmarks = useMyBenchmarks(benchPeriod)

  if (overview.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <CenteredSpinner />
      </div>
    )
  }

  const o = overview.data?.overview
  const monthly = overview.data?.monthly_summary

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-3">
      <header className="mb-2 shrink-0">
        <h1 className="text-base font-bold text-fg">My Analytics</h1>
        <p className="truncate text-[11px] text-fg-muted">
          Your personal productivity trends, deadlines, and work patterns
        </p>
      </header>

      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="mb-2 grid shrink-0 grid-cols-5 gap-2 max-lg:grid-cols-3 max-sm:grid-cols-2"
      >
        <GlassKpi label="Tasks Completed" value={o?.tasks_completed ?? 0} accent="#4CB782" />
        <GlassKpi label="Completion Rate" value={`${o?.completion_rate ?? 0}%`} accent="#2B88EE" />
        <GlassKpi
          label="Avg Completion"
          value={o ? durationLabel(o.avg_completion_time) : '—'}
          accent="#26B5CE"
        />
        <GlassKpi label="On-Time Delivery" value={`${o?.on_time_delivery ?? 0}%`} accent="#8C5BFF" />
        <GlassKpi label="Productivity Streak" value={`${o?.productivity_streak ?? 0}d`} accent="#F2994A" />
      </motion.div>

      <DashboardScrollArea className="pr-1">
        <div className="mx-auto max-w-6xl space-y-3 pb-4">
          {/* Productivity + task trends */}
          <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
            <Panel
              icon={<LineChart size={14} />}
              title="Productivity Trend"
              subtitle="tasks completed per day"
              action={
                <div className="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 p-0.5">
                  {(['week', 'month'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setProdPeriod(p)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors',
                        prodPeriod === p ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:text-fg',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              }
            >
              {productivity.isLoading ? (
                <div className="py-16"><CenteredSpinner /></div>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-4 text-xs text-fg-muted">
                    <span>
                      Total <span className="font-semibold text-fg">{productivity.data?.total ?? 0}</span>
                    </span>
                    <span>
                      Avg/day <span className="font-semibold text-fg">{productivity.data?.average ?? 0}</span>
                    </span>
                  </div>
                  <ProductivityLineChart points={productivity.data?.points ?? []} />
                </>
              )}
            </Panel>

            <Panel icon={<BarChart3 size={14} />} title="Task Completion Trend" subtitle="this week · tasks per weekday">
              {taskTrends.isLoading ? (
                <div className="py-16"><CenteredSpinner /></div>
              ) : (
                <>
                  <p className="mb-3 text-xs text-fg-muted">
                    <span className="font-semibold text-fg">{taskTrends.data?.total ?? 0}</span> tasks completed
                    {taskTrends.data?.week_start && (
                      <span>
                        {' '}
                        · week of{' '}
                        {new Date(`${taskTrends.data.week_start}T00:00:00`).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    )}
                  </p>
                  <TaskTrendBars points={taskTrends.data?.points ?? []} />
                </>
              )}
            </Panel>
          </div>

          {/* Deadline + monthly summary */}
          <div className="grid grid-cols-3 gap-2 max-lg:grid-cols-1">
            <Panel icon={<PieChart size={14} />} title="Deadline Performance" subtitle="last 90 days">
              {deadline.isLoading ? (
                <div className="py-16"><CenteredSpinner /></div>
              ) : (
                <DeadlineDonut
                  slices={deadline.data?.slices ?? []}
                  total={deadline.data?.total ?? 0}
                  onTimeRate={deadline.data?.on_time_rate ?? 0}
                />
              )}
            </Panel>

            <Panel
              className="col-span-2 max-lg:col-span-1"
              icon={<CalendarCheck size={14} />}
              title="Monthly Summary"
              subtitle={monthly?.month}
            >
              <div className="grid grid-cols-5 gap-2 max-sm:grid-cols-2">
                <SummaryTile icon={<CheckCircle2 size={16} />} label="Completed" value={monthly?.completed_tasks ?? 0} />
                <SummaryTile icon={<Target size={16} />} label="Projects" value={monthly?.projects_worked ?? 0} />
                <SummaryTile icon={<MessageSquare size={16} />} label="Comments" value={monthly?.comments ?? 0} />
                <SummaryTile icon={<Paperclip size={16} />} label="Attachments" value={monthly?.attachments ?? 0} />
                <SummaryTile icon={<Clock size={16} />} label="Late tasks" value={monthly?.late_tasks ?? 0} accent="#E5484D" />
              </div>
            </Panel>
          </div>

          {/* Advanced analytics */}
          <div className="flex items-center gap-1.5 pt-1">
            <Zap size={15} className="text-brand" />
            <h2 className="text-sm font-bold text-fg">Advanced Analytics</h2>
            <span className="text-xs text-fg-muted">— last 30 days</span>
          </div>

          <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
            <Panel icon={<Timer size={14} />} title="Work Pattern Analysis">
              {workPattern.isLoading ? (
                <div className="py-12"><CenteredSpinner /></div>
              ) : workPattern.data ? (
                <WorkPatternGrid pattern={workPattern.data} />
              ) : null}
            </Panel>

            <Panel icon={<PieChart size={14} />} title="Time Distribution" subtitle="timer time by project">
              {timeDistribution.isLoading ? (
                <div className="py-12"><CenteredSpinner /></div>
              ) : (
                <TimeDistributionBars
                  slices={timeDistribution.data?.slices ?? []}
                  totalSeconds={timeDistribution.data?.total_seconds ?? 0}
                />
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
            <Panel icon={<GitBranch size={14} />} title="Project Contribution">
              {projectContribution.isLoading ? (
                <div className="py-12"><CenteredSpinner /></div>
              ) : (
                <ProjectContributionBars
                  projects={projectContribution.data?.projects ?? []}
                  total={projectContribution.data?.total_completed ?? 0}
                />
              )}
            </Panel>

            <Panel icon={<Users size={14} />} title="Collaboration Analytics">
              {collaboration.isLoading ? (
                <div className="py-12"><CenteredSpinner /></div>
              ) : collaboration.data ? (
                <CollaborationGrid data={collaboration.data} />
              ) : null}
            </Panel>
          </div>

          <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
            <Panel icon={<Target size={14} />} title="Priority Analysis">
              {priority.isLoading ? (
                <div className="py-12"><CenteredSpinner /></div>
              ) : (
                <PriorityBars slices={priority.data?.slices ?? []} />
              )}
            </Panel>

            <Panel
              icon={<TrendingUp size={14} />}
              title="Personal Benchmarks"
              action={
                <div className="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 p-0.5">
                  {(['week', 'month'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setBenchPeriod(p)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors',
                        benchPeriod === p ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:text-fg',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              }
            >
              {benchmarks.isLoading ? (
                <div className="py-12"><CenteredSpinner /></div>
              ) : (
                <BenchmarkCards metrics={benchmarks.data?.metrics ?? []} />
              )}
            </Panel>
          </div>

          <Panel icon={<TrendingUp size={14} />} title="Personal Activity Timeline">
            {activity.isLoading ? (
              <div className="py-8"><CenteredSpinner /></div>
            ) : (
              <PersonalActivityTimeline
                items={activity.data?.items ?? []}
                timeZone={workPattern.data?.timezone || profileTimezone}
              />
            )}
          </Panel>
        </div>
      </DashboardScrollArea>
    </div>
  )
}

function SummaryTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: number
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-3">
      <div className="flex items-center gap-1.5 text-fg-muted" style={accent ? { color: accent } : undefined}>
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1 text-2xl font-bold text-fg">{value}</p>
    </div>
  )
}
