import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FolderKanban,
  Layers,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useSpaceDashboard } from '../../lib/queries'
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
  HorizontalBars,
  MemberWorkloadCompact,
} from './DashboardWidgets'
import { DashboardPanel, KpiSlot, ScopedDashboardLayout } from './ScopedDashboardLayout'

export default function SpaceAdminDashboard({
  spaceId,
  scopeOptions = [],
  scopeId,
  onScopeChange,
}: {
  spaceId: string
  scopeOptions?: ScopeOption[]
  scopeId?: string
  onScopeChange?: (id: string) => void
}) {
  const { data, isLoading } = useSpaceDashboard(spaceId)
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
      key={spaceId}
      className="h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <ScopedDashboardLayout
        icon={<Layers size={16} className="text-white" />}
        iconStyle={{
          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
          boxShadow: '0 4px 20px rgba(245,158,11,0.3)',
        }}
        title={data.space_name}
        subtitle={
          <>
            <span className="font-medium uppercase tracking-wider text-amber-500 dark:text-amber-400">
              Space Admin
            </span>
            <span className="ml-2">in {data.workspace_name}</span>
            {scopeCount > 1 && (
              <span className="ml-1.5 text-fg-muted">· admin of {scopeCount} spaces</span>
            )}
          </>
        }
        scopeOptions={scopeOptions}
        scopeId={scopeId ?? spaceId}
        onScopeChange={onScopeChange}
        headerRight={
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
                onClick: () => navigate(peoplePageUrl({ spaceId })),
                title: 'View space members',
              },
            ]}
          />
        }
        kpis={
          <>
            <KpiSlot>
              <GlassKpi label="Tasks" value={data.kpis.total_tasks} accent="#f59e0b" />
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
              <GlassKpi label="Projects" value={data.kpis.projects} accent="#818cf8" />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi label="Done %" value={`${data.kpis.completion_percent}%`} accent="#34d399" />
            </KpiSlot>
          </>
        }
      >
        <DashboardPanel icon={<FolderKanban size={12} />} title="Project Progress" className="col-span-5 row-span-1">
          <DashboardScrollArea>
            <HorizontalBars
              items={data.project_progress.map((p) => ({
                label: p.name,
                value: p.progress_percent,
                color: p.color,
                id: p.project_id,
              }))}
            />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<BarChart3 size={12} />} title="Task Distribution" className="col-span-4 row-span-1">
          <DashboardScrollArea>
            <GlowDonut breakdown={data.task_status_breakdown} total={data.task_status_total} size={88} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Users size={12} />} title="Assignee Load" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <MemberWorkloadCompact members={data.member_workload} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<AlertTriangle size={12} />} title="Critical Tasks" className="col-span-6 row-span-1">
          <DashboardScrollArea>
            <CriticalTasksCompact tasks={data.critical_tasks} total={data.critical_tasks_total} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Activity size={12} />} title="Recent Activity" className="col-span-6 row-span-1">
          <DashboardScrollArea>
            <ActivityFeedCompact activities={data.recent_activities} />
          </DashboardScrollArea>
        </DashboardPanel>
      </ScopedDashboardLayout>
    </motion.div>
  )
}
