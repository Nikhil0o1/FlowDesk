import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FolderKanban,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useOrgDashboard } from '../../lib/queries'
import { CenteredSpinner } from '../ui/Spinner'
import {
  ActivityFeedCompact,
  CriticalTasksCompact,
  DashboardScrollArea,
  GlassKpi,
  GlowDonut,
  HorizontalBars,
  ProgressRing,
  TeamWorkloadCompact,
} from './DashboardWidgets'
import { TeamProductivityChart } from './TeamProductivityChart'
import { DashboardPanel, KpiSlot, ScopedDashboardLayout } from './ScopedDashboardLayout'

export default function OrgAdminDashboard({ orgId }: { orgId: string }) {
  const { data, isLoading } = useOrgDashboard(orgId)
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
      className="h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <ScopedDashboardLayout
        icon={<ShieldCheck size={16} className="text-white" />}
        iconStyle={{
          background: 'linear-gradient(135deg, #14b8a6, #0e7490)',
          boxShadow: '0 4px 20px rgba(20,184,166,0.35)',
        }}
        title={data.organization_name}
        subtitle={
          <span className="font-medium uppercase tracking-wider text-teal-500 dark:text-teal-400">
            Organization Admin
          </span>
        }
        headerRight={
          <button
            type="button"
            onClick={() => navigate('/app/teams?tab=people')}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg shadow-teal-500/20"
          >
            <UserCheck size={12} /> Manage People
          </button>
        }
        kpis={
          <>
            <KpiSlot>
              <GlassKpi
                label="Workspaces"
                value={data.kpis.workspaces}
                trend={data.kpis.trends.workspaces}
                accent="#a78bfa"
                onClick={() => navigate('/app/workspaces')}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Members"
                value={data.kpis.organization_members}
                trend={data.kpis.trends.organization_members}
                accent="#22d3ee"
                onClick={() => navigate('/app/teams?tab=people')}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Teams"
                value={data.kpis.teams}
                trend={data.kpis.trends.teams}
                accent="#14b8a6"
                onClick={() => navigate('/app/teams')}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Projects"
                value={data.kpis.active_projects}
                trend={data.kpis.trends.active_projects}
                accent="#8C5BFF"
                onClick={() => navigate('/app/board')}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Sprints"
                value={data.kpis.active_sprints}
                trend={data.kpis.trends.active_sprints}
                accent="#fbbf24"
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
          </>
        }
      >
        <DashboardPanel icon={<TrendingUp size={12} />} title="Overall Health" className="col-span-3 row-span-1">
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <ProgressRing
              percent={data.kpis.completion_percent}
              size={88}
              strokeWidth={7}
              color="#14b8a6"
              sublabel="completed"
            />
            <div className="flex gap-4 text-xs">
              <span className="text-fg-muted">{data.kpis.overdue_tasks} overdue</span>
              <span className="text-teal-500 dark:text-teal-400">{data.kpis.active_sprints} sprints</span>
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel icon={<BarChart3 size={12} />} title="Task Status" className="col-span-4 row-span-1">
          <DashboardScrollArea>
            <GlowDonut breakdown={data.task_status_breakdown} total={data.task_status_total} size={88} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel
          icon={<TrendingUp size={12} />}
          title={
            data.team_productivity_summary?.display_mode === 'workspace'
              ? 'Workspace Productivity'
              : 'Team Productivity'
          }
          className="col-span-5 row-span-1"
        >
          <TeamProductivityChart
            series={data.team_productivity_series}
            trend={data.team_productivity_trend}
            summary={data.team_productivity_summary}
          />
        </DashboardPanel>

        <DashboardPanel icon={<FolderKanban size={12} />} title="Project Progress" className="col-span-3 row-span-1">
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

        <DashboardPanel icon={<AlertTriangle size={12} />} title="Needs Attention" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <CriticalTasksCompact tasks={data.critical_tasks} total={data.critical_tasks_total} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Users size={12} />} title="Team Workload" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <TeamWorkloadCompact rows={data.team_workload} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Activity size={12} />} title="Activity Log" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <ActivityFeedCompact activities={data.recent_activities} />
          </DashboardScrollArea>
        </DashboardPanel>
      </ScopedDashboardLayout>
    </motion.div>
  )
}
