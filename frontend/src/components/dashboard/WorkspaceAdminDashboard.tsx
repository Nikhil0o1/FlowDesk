import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  FolderKanban,
  Layers,
  Users,
  Zap,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useWorkspaceDashboard } from '../../lib/queries'
import { peoplePageUrl } from '../../lib/peopleRoutes'
import type { SpaceOverviewRow } from '../../lib/types'
import { CenteredSpinner } from '../ui/Spinner'
import {
  ActivityFeedCompact,
  CriticalTasksCompact,
  DashboardScrollArea,
  GlassKpi,
  GlowDonut,
  MemberWorkloadCompact,
  ProjectProgressCompact,
  SprintPills,
} from './DashboardWidgets'
import { DashboardScopeStats } from './DashboardScopeStats'
import { DashboardPanel, KpiSlot, ScopedDashboardLayout } from './ScopedDashboardLayout'

export default function WorkspaceAdminDashboard({
  workspaceId,
  adminWorkspaceCount = 1,
  orgDrillDown = false,
}: {
  workspaceId: string
  adminWorkspaceCount?: number
  /** Org owner/admin viewing a workspace from Workspaces drill-down */
  orgDrillDown?: boolean
}) {
  const { data, isLoading } = useWorkspaceDashboard(workspaceId)
  const navigate = useNavigate()

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <CenteredSpinner />
      </div>
    )
  }
  if (!data) return null

  return (
    <motion.div
      key={workspaceId}
      className="h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <ScopedDashboardLayout
        icon={<Boxes size={16} className="text-white" />}
        iconStyle={{
          background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
          boxShadow: '0 4px 20px rgba(99,102,241,0.3)',
        }}
        title={data.workspace_name}
        subtitle={
          <>
            <span className="font-medium uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
              {orgDrillDown ? 'Workspace overview' : 'Workspace Admin'}
            </span>
            {adminWorkspaceCount > 1 && (
              <span className="ml-2">· switch workspace in the top bar</span>
            )}
          </>
        }
        headerRight={
          <DashboardScopeStats
            items={[
              {
                icon: <Layers size={10} />,
                count: data.kpis.spaces,
                noun: 'space',
              },
              {
                icon: <FolderKanban size={10} />,
                count: data.kpis.projects,
                noun: 'project',
              },
              {
                icon: <Users size={10} />,
                count: data.kpis.members,
                noun: 'member',
                onClick: () => navigate(peoplePageUrl({ workspaceId })),
                title: 'View workspace members',
              },
            ]}
          />
        }
        kpis={
          <>
            <KpiSlot>
              <GlassKpi label="Tasks" value={data.kpis.total_tasks} accent="#6366f1" />
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
              <GlassKpi label="Open" value={data.kpis.open_tasks} accent="#fbbf24" />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Sprints"
                value={data.kpis.active_sprints}
                accent="#8C5BFF"
                onClick={() => navigate('/app/sprints')}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi label="Done %" value={`${data.kpis.completion_percent}%`} accent="#34d399" />
            </KpiSlot>
          </>
        }
      >
        <DashboardPanel icon={<Boxes size={12} />} title="Spaces" className="col-span-7 row-span-1">
          <DashboardScrollArea>
            <SpacesHeatmap spaces={data.space_overview} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<BarChart3 size={12} />} title="Task Status" className="col-span-5 row-span-1">
          <DashboardScrollArea>
            <GlowDonut breakdown={data.task_status_breakdown} total={data.task_status_total} size={88} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<FolderKanban size={12} />} title="Projects" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <ProjectProgressCompact rows={data.project_progress} total={data.project_progress_total} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Users size={12} />} title="Workload" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <MemberWorkloadCompact members={data.member_workload} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Zap size={12} />} title="Sprints" className="col-span-2 row-span-1">
          <DashboardScrollArea>
            <SprintPills sprints={data.active_sprints} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<AlertTriangle size={12} />} title="Critical" className="col-span-2 row-span-1">
          <DashboardScrollArea>
            <CriticalTasksCompact tasks={data.critical_tasks} total={data.critical_tasks_total} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Activity size={12} />} title="Activity" className="col-span-2 row-span-1">
          <DashboardScrollArea>
            <ActivityFeedCompact activities={data.recent_activities} />
          </DashboardScrollArea>
        </DashboardPanel>
      </ScopedDashboardLayout>
    </motion.div>
  )
}

function SpacesHeatmap({ spaces }: { spaces: SpaceOverviewRow[] }) {
  if (spaces.length === 0) return <p className="py-2 text-center text-xs text-fg-muted">No spaces.</p>

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {spaces.map((s) => {
        const pct = s.task_count > 0 ? Math.round((s.done_count / s.task_count) * 100) : 0
        return (
          <div
            key={s.space_id}
            className="flex min-h-[52px] flex-col justify-center rounded-lg border border-gray-200/70 bg-white/80 px-2 py-1.5 dark:border-white/[0.06] dark:bg-white/[0.02]"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                style={{ backgroundColor: s.color }}
              >
                {s.name[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-fg" title={s.name}>
                {s.name}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.05]">
                <div className="h-full rounded-full" style={{ backgroundColor: s.color, width: `${pct}%` }} />
              </div>
              <span className="font-mono text-[9px] text-fg-muted">{pct}%</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
