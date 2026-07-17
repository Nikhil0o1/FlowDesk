import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Crown,
  FolderKanban,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useOrgDashboard, useOrganizationMembers } from '../../lib/queries'
import { CenteredSpinner } from '../ui/Spinner'
import {
  ActivityFeedCompact,
  CriticalTasksCompact,
  DashboardScrollArea,
  GlassKpi,
  GlowDonut,
  HorizontalBars,
  OrgMembersCompact,
  PortfolioHealthList,
  ProgressRing,
} from './DashboardWidgets'
import { DeliveryVelocityChart } from './DeliveryVelocityChart'
import { DashboardPanel, KpiSlot, ScopedDashboardLayout } from './ScopedDashboardLayout'

export default function OrgOwnerDashboard({ orgId }: { orgId: string }) {
  const { data, isLoading } = useOrgDashboard(orgId)
  const { data: members = [], isLoading: membersLoading } = useOrganizationMembers(orgId)
  const navigate = useNavigate()

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <CenteredSpinner />
      </div>
    )
  }
  if (!data) return null

  const portfolioHealthy = data.project_portfolio.filter((p) => p.health === 'healthy').length
  const portfolioTotal = data.project_portfolio.length

  return (
    <motion.div
      className="h-full min-h-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <ScopedDashboardLayout
        icon={<Crown size={16} className="text-white" />}
        iconStyle={{
          background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
          boxShadow: '0 4px 20px rgba(139,92,246,0.35)',
        }}
        title={data.organization_name}
        subtitle={
          <span className="font-medium uppercase tracking-wider text-violet-500 dark:text-violet-400">
            Organization Owner
          </span>
        }
        headerRight={
          <button
            type="button"
            onClick={() => navigate('/app/settings?tab=organization&transfer=1')}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg shadow-violet-500/20 transition-shadow hover:shadow-violet-500/40"
          >
            <Shield size={12} /> Transfer Ownership
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
                label="Projects"
                value={data.kpis.active_projects}
                trend={data.kpis.trends.active_projects}
                accent="#8C5BFF"
                onClick={() => navigate('/app/board')}
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
                accent="#f472b6"
                onClick={() => navigate('/app/teams')}
              />
            </KpiSlot>
            <KpiSlot>
              <GlassKpi
                label="Sprints"
                value={data.kpis.active_sprints}
                trend={data.kpis.trends.active_sprints}
                accent="#fbbf24"
                onClick={() => navigate('/app/sprints')}
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
        <DashboardPanel icon={<BarChart3 size={12} />} title="Task Distribution" className="col-span-4 row-span-1">
          <DashboardScrollArea>
            <GlowDonut breakdown={data.task_status_breakdown} total={data.task_status_total} size={100} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<TrendingUp size={12} />} title="Delivery Velocity · last 7 days" className="col-span-4 row-span-1">
          <DeliveryVelocityChart
            trend={data.delivery_velocity_trend}
            summary={data.delivery_velocity_summary}
          />
        </DashboardPanel>

        <DashboardPanel icon={<FolderKanban size={12} />} title="Portfolio Health" className="col-span-4 row-span-1">
          <div className="flex h-full min-h-0 gap-3 overflow-hidden">
            <div className="flex shrink-0 items-center self-stretch">
              <ProgressRing
                percent={portfolioTotal > 0 ? Math.round((portfolioHealthy / portfolioTotal) * 100) : 0}
                size={72}
                strokeWidth={6}
                color="#34d399"
                label="healthy"
              />
            </div>
            <DashboardScrollArea className="min-h-0 min-w-0 flex-1">
              <PortfolioHealthList projects={data.project_portfolio} />
            </DashboardScrollArea>
          </div>
        </DashboardPanel>

        <DashboardPanel icon={<BarChart3 size={12} />} title="Project Progress" className="col-span-3 row-span-1">
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

        <DashboardPanel icon={<AlertTriangle size={12} />} title="Critical Tasks" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <CriticalTasksCompact tasks={data.critical_tasks} total={data.critical_tasks_total} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Activity size={12} />} title="Activity" className="col-span-3 row-span-1">
          <DashboardScrollArea>
            <ActivityFeedCompact activities={data.recent_activities} />
          </DashboardScrollArea>
        </DashboardPanel>

        <DashboardPanel icon={<Users size={12} />} title="Organization Members" className="col-span-3 row-span-1">
          {membersLoading ? (
            <p className="py-3 text-center text-xs text-fg-muted">Loading members…</p>
          ) : (
            <DashboardScrollArea>
              <OrgMembersCompact
                members={members}
                onViewAll={() => navigate('/app/teams?tab=people')}
              />
            </DashboardScrollArea>
          )}
        </DashboardPanel>
      </ScopedDashboardLayout>
    </motion.div>
  )
}
