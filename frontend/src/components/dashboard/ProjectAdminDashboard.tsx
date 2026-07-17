import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FolderKanban,
  Users,
  Zap,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useProjectDashboard } from '../../lib/queries'
import { peoplePageUrl } from '../../lib/peopleRoutes'
import { CenteredSpinner } from '../ui/Spinner'
import type { ScopeOption } from './AdminScopeSwitcher'
import { DashboardScopeStats } from './DashboardScopeStats'
import {
  ActivityFeedCompact,
  CriticalTasksCompact,
  DashboardScrollArea,
  GlassKpi,
  GlowDonut,
  MemberWorkloadCompact,
  SprintPills,
} from './DashboardWidgets'
import { DashboardPanel, KpiSlot, ScopedDashboardLayout } from './ScopedDashboardLayout'

export default function ProjectAdminDashboard({
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
  const { data, isLoading } = useProjectDashboard(projectId)
  const navigate = useNavigate()

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <CenteredSpinner />
      </div>
    )
  }
  if (!data) return null

  const scopeCount = scopeOptions.length

  return (
    <motion.div
      key={projectId}
      className="h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
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
              Project Admin
            </span>
            {data.space_name && <span className="ml-2">in {data.space_name}</span>}
            {scopeCount > 1 && (
              <span className="ml-1.5 text-fg-muted">· admin of {scopeCount} projects</span>
            )}
          </>
        }
        scopeOptions={scopeOptions}
        scopeId={scopeId ?? projectId}
        onScopeChange={onScopeChange}
        headerRight={
          <div className="flex shrink-0 items-center gap-2">
            <DashboardScopeStats
              items={[
                {
                  icon: <FolderKanban size={10} />,
                  count: data.kpis.projects,
                  noun: 'project',
                },
                {
                  icon: <Users size={10} />,
                  count: data.kpis.members,
                  noun: 'member',
                  onClick: () => navigate(peoplePageUrl({ projectId })),
                  title: 'View project members',
                },
              ]}
            />
            <button
              type="button"
              onClick={() => navigate(`/app/projects/${projectId}`)}
              className="rounded-lg border border-ink-700 bg-ink-800/80 px-2.5 py-1.5 text-[11px] font-medium text-fg-secondary transition-colors hover:border-ink-600 hover:text-fg"
            >
              Open project
            </button>
          </div>
        }
        kpis={
          <>
            <KpiSlot>
              <GlassKpi label="Tasks" value={data.kpis.total_tasks} accent={data.project_color} />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi label="Open" value={data.kpis.open_tasks} accent="#fbbf24" />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Completed"
                value={data.kpis.completed_tasks}
                trend={data.kpis.trends.completed_tasks}
                accent="#34d399"
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Overdue"
                value={data.kpis.overdue_tasks}
                trend={data.kpis.trends.overdue_tasks}
                accent={data.kpis.overdue_tasks > 0 ? '#f87171' : '#6b7280'}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi label="Velocity" value={data.kpis.sprint_velocity} accent="#818cf8" />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi label="Done %" value={`${data.kpis.completion_percent}%`} accent={data.project_color} />
            </KpiSlot>
          </>
        }
      >
        <DashboardPanel icon={<BarChart3 size={12} />} title="Task Board" className="col-span-5 row-span-1">
          <DashboardScrollArea>
            <GlowDonut breakdown={data.task_status_breakdown} total={data.task_status_total} size={88} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Zap size={12} />} title="Active Sprints" className="col-span-4 row-span-1">
          <DashboardScrollArea>
            <SprintPills sprints={data.active_sprints} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Users size={12} />} title="Workload" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <MemberWorkloadCompact members={data.member_workload} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<AlertTriangle size={12} />} title="Needs Attention" className="col-span-6 row-span-1">
          <DashboardScrollArea>
            <CriticalTasksCompact tasks={data.critical_tasks} total={data.critical_tasks_total} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Activity size={12} />} title="Activity" className="col-span-6 row-span-1">
          <DashboardScrollArea>
            <ActivityFeedCompact activities={data.recent_activities} />
          </DashboardScrollArea>
        </DashboardPanel>
      </ScopedDashboardLayout>
    </motion.div>
  )
}
