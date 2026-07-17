import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  FolderKanban,
  Zap,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useProjectMemberDashboard } from '../../lib/queries'
import { projectMemberKpiNavigation } from '../../lib/projectMemberDashboardRoutes'
import { formatScopedRole } from '../../lib/roleLabels'
import { cn } from '../../lib/utils'
import { useRealtime } from '../../lib/ws'
import { CenteredSpinner } from '../ui/Spinner'
import type { ScopeOption } from './AdminScopeSwitcher'
import {
  ActivityFeedCompact,
  CriticalTasksCompact,
  DashboardScrollArea,
  GlassKpi,
  GlowDonut,
  SprintPills,
} from './DashboardWidgets'
import { DashboardPanel, KpiSlot, ScopedDashboardLayout } from './ScopedDashboardLayout'

export default function ProjectMemberDashboard({
  projectId,
  scopeOptions = [],
  scopeId,
  onScopeChange,
}: {
  projectId: string
  scopeOptions?: ScopeOption[]
  scopeId?: string
  onScopeChange?: (id: string) => void
}) {
  const { data, isLoading } = useProjectMemberDashboard(projectId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useRealtime(
    ['task.updated', 'task.created', 'task.deleted', 'task.assigned', 'sprint.updated'],
    (event) => {
      if (event.project_id === projectId) {
        void queryClient.invalidateQueries({ queryKey: ['project-member-dashboard', projectId] })
      }
    },
    [projectId],
  )

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <CenteredSpinner />
      </div>
    )
  }
  if (!data) return null

  const scopeCount = scopeOptions.length
  const roleLabel = formatScopedRole('project', data.my_role)
  const isViewer = data.my_role === 'viewer'
  const activeSprintId = data.active_sprints.find((s) => s.status === 'active')?.sprint_id ?? data.active_sprints[0]?.sprint_id
  const kpiNav = projectMemberKpiNavigation(projectId, isViewer, activeSprintId)

  return (
    <motion.div
      key={projectId}
      className="flex h-full min-h-0 flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="min-h-0 flex-1">
        <div className="h-full min-h-0">
        <ScopedDashboardLayout
        icon={<FolderKanban size={16} className="text-white" />}
        iconStyle={{
          background: `linear-gradient(135deg, ${data.project_color}, ${data.project_color}cc)`,
          boxShadow: `0 4px 20px ${data.project_color}40`,
        }}
        title={data.project_name}
        subtitle={
          <>
            <span className="font-medium uppercase tracking-wider" style={{ color: data.project_color }}>
              {roleLabel}
            </span>
            {data.space_name && <span className="ml-2">in {data.space_name}</span>}
            {scopeCount > 1 && (
              <span className="ml-1.5 text-fg-muted">
                · {isViewer ? 'viewing' : 'member of'} {scopeCount} projects
              </span>
            )}
          </>
        }
        scopeOptions={scopeOptions}
        scopeId={scopeId ?? projectId}
        onScopeChange={onScopeChange}
        scopeMenuHeading="Your projects"
        headerRight={
          <button
            type="button"
            onClick={() => navigate(`/app/projects/${projectId}`)}
            className="rounded-lg border border-ink-700 bg-ink-800/80 px-2.5 py-1.5 text-[11px] font-medium text-fg-secondary transition-colors hover:border-ink-600 hover:text-fg"
          >
            {isViewer ? 'View project' : 'Open project'}
          </button>
        }
        kpis={
          <>
            <KpiSlot>
              <GlassKpi
                label={isViewer ? 'Open Tasks' : 'My Open'}
                value={data.kpis.my_open_tasks}
                accent={data.project_color}
                onClick={() => navigate(kpiNav.openTasks())}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Overdue"
                value={data.kpis.my_overdue}
                trend={data.kpis.trends.my_overdue}
                accent={data.kpis.my_overdue > 0 ? '#f87171' : '#6b7280'}
                onClick={() => navigate(kpiNav.overdue())}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Due This Week"
                value={data.kpis.my_due_this_week}
                accent="#fbbf24"
                onClick={() => navigate(kpiNav.dueThisWeek())}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label={isViewer ? 'Completed (week)' : 'Completed'}
                value={data.kpis.my_completed_this_week}
                trend={data.kpis.trends.my_completed_this_week}
                accent="#34d399"
                onClick={() => navigate(kpiNav.completedThisWeek())}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Project Done"
                value={`${data.kpis.project_completion_percent}%`}
                accent={data.project_color}
                onClick={() => navigate(kpiNav.projectProgress())}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Active Sprints"
                value={data.kpis.active_sprint_count}
                accent="#818cf8"
                onClick={() => navigate(kpiNav.activeSprints())}
              />
            </KpiSlot>
          </>
        }
      >
        <DashboardPanel
          icon={<BarChart3 size={12} />}
          title={isViewer ? 'Task Board' : 'My Task Board'}
          className="col-span-5 row-span-1"
        >
          <DashboardScrollArea>
            {data.my_task_status_total === 0 ? (
              <p className="py-6 text-center text-xs text-fg-muted">
                {isViewer ? 'No open tasks in this project.' : 'No open tasks assigned to you.'}
              </p>
            ) : (
              <GlowDonut
                breakdown={data.my_task_status_breakdown}
                total={data.my_task_status_total}
                size={88}
              />
            )}
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Zap size={12} />} title="Active Sprints" className="col-span-4 row-span-1">
          <DashboardScrollArea>
            <SprintPills sprints={data.active_sprints} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<CalendarClock size={12} />} title={isViewer ? 'Focus' : 'My Focus'} className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <div className="space-y-2 px-1 py-1">
              <FocusRow
                label="Due today"
                value={data.kpis.my_due_today}
                accent="#fbbf24"
                onClick={() => navigate(kpiNav.dueToday())}
              />
              <FocusRow
                label="Due this week"
                value={data.kpis.my_due_this_week}
                accent="#818cf8"
                onClick={() => navigate(kpiNav.dueThisWeek())}
              />
              <FocusRow
                label="Needs attention"
                value={data.my_attention_total}
                accent={data.my_attention_total > 0 ? '#f87171' : '#6b7280'}
              />
            </div>
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel
          icon={<AlertTriangle size={12} />}
          title={isViewer ? 'Needs Attention' : 'Needs My Attention'}
          className="col-span-6 row-span-1"
        >
          <DashboardScrollArea>
            <CriticalTasksCompact tasks={data.my_attention_tasks} total={data.my_attention_total} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Activity size={12} />} title="Recent Activity" className="col-span-6 row-span-1">
          <DashboardScrollArea>
            <ActivityFeedCompact activities={data.recent_activities} />
          </DashboardScrollArea>
        </DashboardPanel>
        </ScopedDashboardLayout>
        </div>
      </div>
    </motion.div>
  )
}

function FocusRow({
  label,
  value,
  accent,
  onClick,
}: {
  label: string
  value: number
  accent: string
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-lg border border-ink-700/80 bg-ink-900/40 px-2.5 py-2',
        onClick && 'cursor-pointer transition-colors hover:border-ink-600 hover:bg-ink-800/60',
      )}
    >
      <span className="text-xs text-fg-secondary">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: accent }}>
          {value}
        </span>
        {onClick && <ArrowUpRight size={12} className="text-fg-muted/50" />}
      </span>
    </Tag>
  )
}
