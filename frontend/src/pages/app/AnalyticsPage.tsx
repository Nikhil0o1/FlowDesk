import { motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  Bell,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  FileType,
  Grid3x3,
  LineChart,
  MonitorSmartphone,
  Radio,
  Search,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  ActivityFeed,
  StatusDonut,
  StatusPill,
  TimelineChart,
  durationLabel,
} from '../../components/analytics/AnalyticsWidgets'
import { EmployeeDetailDrawer } from '../../components/analytics/EmployeeDetailDrawer'
import { ContributionHeatmap } from '../../components/analytics/ContributionHeatmap'
import {
  AlertsList,
  DeviceBars,
  TrendsChart,
} from '../../components/analytics/HistoricalWidgets'
import { TeamComparison } from '../../components/analytics/TeamComparison'
import { GlassKpi, stagger } from '../../components/dashboard/DashboardWidgets'
import { Avatar } from '../../components/ui/Avatar'
import { Dropdown } from '../../components/ui/Dropdown'
import { EmptyState } from '../../components/ui/EmptyState'
import { CenteredSpinner } from '../../components/ui/Spinner'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useAnalyticsScope } from '../../hooks/useAnalyticsScope'
import { exportPresence, type ExportFormat } from '../../lib/analyticsExport'
import { api } from '../../lib/api'
import {
  analyticsQueryTail,
  useAnalyticsActivityFeed,
  useAnalyticsAlerts,
  useAnalyticsContributionHeatmap,
  useAnalyticsDevices,
  useAnalyticsOverview,
  useAnalyticsStatusDistribution,
  useAnalyticsTimeline,
  useAnalyticsTrends,
  useAnalyticsUsers,
  useCurrentContext,
  useProjects,
  useSpaces,
  useTeams,
  useUserRoles,
} from '../../lib/queries'
import { canAccessAnalytics } from '../../lib/roleHierarchy'
import type { PresenceStatus, PresenceUsersPage } from '../../lib/types'
import { addDays, cn, formatDateTimeInTimezone, formatTimezoneLabel, timeAgo, todayDateKeyInTimezone, toDateKey } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'online', label: 'Online' },
  { value: 'busy', label: 'Busy' },
  { value: 'away', label: 'Away' },
  { value: 'offline', label: 'Offline' },
]

const ROLE_FILTERS = [
  { value: '', label: 'All roles' },
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
]

const TREND_PERIODS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
]

function selectClass() {
  return 'rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-fg-secondary transition-colors hover:border-ink-600 focus:border-brand focus:outline-none'
}

export default function AnalyticsPage() {
  const { org, isLoading: contextLoading } = useCurrentContext()
  const { data: roles, isLoading: rolesLoading } = useUserRoles()
  const analyticsScope = useAnalyticsScope()
  const viewerTimezone = useAuthStore((s) => s.user?.profile?.timezone || 'UTC')

  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [spaceId, setSpaceId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [date, setDate] = useState(() => todayDateKeyInTimezone(viewerTimezone))
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 300)
  const [page, setPage] = useState(1)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [trendDays, setTrendDays] = useState(90)
  const [scopeInitKey, setScopeInitKey] = useState<string | null>(null)

  // Apply role-based default scope once roles/context are ready.
  useEffect(() => {
    if (!analyticsScope.ready || !org?.id) return
    const key = `${org.id}:${roles?.highest_role ?? ''}`
    if (scopeInitKey === key) return
    setWorkspaceId(analyticsScope.defaults.workspaceId)
    setSpaceId(analyticsScope.defaults.spaceId)
    setProjectId(analyticsScope.defaults.projectId)
    setTeamId('')
    setScopeInitKey(key)
  }, [
    analyticsScope.defaults,
    analyticsScope.ready,
    org?.id,
    roles?.highest_role,
    scopeInitKey,
  ])

  // Keep the timeline date aligned when the viewer changes profile timezone.
  useEffect(() => {
    setDate(todayDateKeyInTimezone(viewerTimezone))
  }, [viewerTimezone])

  // Dependent filter option sources (org leaders drill down by workspace).
  const spaces = useSpaces(
    analyticsScope.orgLeader ? workspaceId || undefined : workspaceId || undefined,
  )
  const projects = useProjects(workspaceId || undefined)
  const teams = useTeams(workspaceId || undefined)

  const hasAccess = canAccessAnalytics(roles?.highest_role)

  const filtersReady =
    analyticsScope.ready &&
    (analyticsScope.orgLeader ||
      scopeInitKey === `${org?.id}:${roles?.highest_role ?? ''}`)

  const activeOrgId = filtersReady ? org?.id : undefined

  const populationTail = useMemo(
    () =>
      analyticsQueryTail({
        workspace_id: workspaceId || undefined,
        space_id: spaceId || undefined,
        project_id: projectId || undefined,
        team_id: teamId || undefined,
      }),
    [workspaceId, spaceId, projectId, teamId],
  )
  const workspaceTail = useMemo(
    () => analyticsQueryTail({ workspace_id: workspaceId || undefined }),
    [workspaceId],
  )
  const timelineTail = useMemo(
    () => `${populationTail}${analyticsQueryTail({ date })}`,
    [populationTail, date],
  )
  const usersTail = useMemo(
    () =>
      `${populationTail}${analyticsQueryTail({
        status: status || undefined,
        role: role || undefined,
        search: search || undefined,
        page: String(page),
        page_size: '25',
      })}`,
    [populationTail, status, role, search, page],
  )

  const overview = useAnalyticsOverview(activeOrgId, populationTail)
  const timeline = useAnalyticsTimeline(activeOrgId, timelineTail)
  const distribution = useAnalyticsStatusDistribution(activeOrgId, populationTail)
  const users = useAnalyticsUsers(activeOrgId, usersTail)
  const activity = useAnalyticsActivityFeed(activeOrgId, populationTail)
  const trends = useAnalyticsTrends(activeOrgId, trendDays, populationTail)
  const contributionHeatmap = useAnalyticsContributionHeatmap(activeOrgId, trendDays, populationTail)
  const devices = useAnalyticsDevices(activeOrgId, trendDays, populationTail)
  const alerts = useAnalyticsAlerts(activeOrgId, populationTail)

  const projectOptions = useMemo(() => {
    if (analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin) {
      const all = projects.data ?? []
      return spaceId ? all.filter((p) => p.space_id === spaceId) : all
    }
    if (analyticsScope.isProjectAdminOnly) {
      return analyticsScope.projectOptions
        .filter((p) => !workspaceId || p.workspace_id === workspaceId)
        .map((p) => ({ id: p.id, name: p.name, space_id: null as string | null }))
    }
    return []
  }, [
    analyticsScope.isWorkspaceAdmin,
    analyticsScope.isProjectAdminOnly,
    analyticsScope.orgLeader,
    analyticsScope.projectOptions,
    projects.data,
    spaceId,
    workspaceId,
  ])

  const visibleSpaces = useMemo(() => {
    if (analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin) return spaces.data ?? []
    if (analyticsScope.isSpaceAdminOnly) {
      return analyticsScope.spaceOptions
        .filter((s) => !workspaceId || s.workspace_id === workspaceId)
        .map((s) => ({ id: s.id, name: s.name }))
    }
    return []
  }, [
    analyticsScope.isWorkspaceAdmin,
    analyticsScope.isSpaceAdminOnly,
    analyticsScope.orgLeader,
    analyticsScope.spaceOptions,
    spaces.data,
    workspaceId,
  ])

  const handleWorkspaceChange = (next: string) => {
    setWorkspaceId(next)
    setPage(1)
    if (analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin) {
      setSpaceId('')
      setProjectId('')
      setTeamId('')
    }
  }

  const handleSpaceChange = (next: string) => {
    setSpaceId(next)
    setProjectId('')
    setPage(1)
    if (analyticsScope.isSpaceAdminOnly && next) {
      const space = analyticsScope.spaceOptions.find((s) => s.id === next)
      if (space?.workspace_id) setWorkspaceId(space.workspace_id)
    }
  }

  const handleProjectChange = (next: string) => {
    setProjectId(next)
    setPage(1)
    if (analyticsScope.isProjectAdminOnly && next) {
      const project = analyticsScope.projectOptions.find((p) => p.id === next)
      if (project?.workspace_id) setWorkspaceId(project.workspace_id)
    }
  }

  const handleExport = async (format: ExportFormat) => {
    if (!org?.id) return
    setExporting(true)
    try {
      const rows = await fetchAllPresence(org.id, usersTail)
      if (rows.length === 0) {
        toast.error('No rows to export')
        return
      }
      await exportPresence(rows, format)
      toast.success(`Exported ${rows.length} rows`)
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  if (contextLoading || rolesLoading) return <CenteredSpinner />

  if (!hasAccess) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-7">
        <EmptyState
          icon={Radio}
          title="No access to Analytics"
          description="Analytics is available to organization owners/admins and workspace, space, or project admins — not to regular members."
        />
      </div>
    )
  }

  if (!filtersReady) return <CenteredSpinner />

  const o = overview.data
  const dist = distribution.data
  const usersPage = users.data
  const totalPages = usersPage ? Math.max(1, Math.ceil(usersPage.total / usersPage.page_size)) : 1
  const isToday = date === todayDateKeyInTimezone(viewerTimezone)
  const tzLabel = formatTimezoneLabel(timeline.data?.timezone || viewerTimezone)

  return (
    <div className="mx-auto max-w-6xl px-8 py-7">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-fg">Analytics</h1>
          <p className="mt-0.5 text-sm text-fg-secondary">
            {analyticsScope.orgLeader
              ? "See who's online and what they're working on across the organization"
              : `Presence for people in your scope as ${analyticsScope.scopeLabel || 'admin'}`}
            <span className="text-fg-muted"> · Times in {tzLabel}</span>
          </p>
          <p className="mt-1 text-[11px] text-fg-muted">
            {analyticsScope.orgLeader
              ? 'Org owners and admins share full-org visibility.'
              : analyticsScope.isWorkspaceAdmin
                ? 'Workspace scope: anyone in your workspaces (any role) — org owners/admins stay hidden.'
                : analyticsScope.isSpaceAdminOnly
                  ? 'Space scope: anyone in your spaces (any role) — org owners/admins stay hidden.'
                  : analyticsScope.isProjectAdminOnly
                    ? 'Project scope: anyone in your projects (any role) — org owners/admins stay hidden.'
                    : null}
          </p>
        </div>
        <Dropdown
          align="right"
          width="w-44"
          trigger={
            <button className="btn-secondary" disabled={exporting}>
              <Download size={15} /> {exporting ? 'Exporting…' : 'Export'}
            </button>
          }
        >
          {(close) => (
            <>
              <button className="menu-item" onClick={() => { close(); void handleExport('csv') }}>
                <FileText size={14} /> CSV
              </button>
              <button className="menu-item" onClick={() => { close(); void handleExport('excel') }}>
                <FileSpreadsheet size={14} /> Excel
              </button>
              <button className="menu-item" onClick={() => { close(); void handleExport('pdf') }}>
                <FileType size={14} /> PDF
              </button>
            </>
          )}
        </Dropdown>
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <select className={selectClass()} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        {analyticsScope.canPickOrgRole ? (
          <select className={selectClass()} value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }}>
            {ROLE_FILTERS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        ) : null}

        {(analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin) ? (
          <select
            className={cn(selectClass(), analyticsScope.lockWorkspace && 'opacity-70')}
            value={workspaceId}
            disabled={analyticsScope.lockWorkspace}
            onChange={(e) => handleWorkspaceChange(e.target.value)}
          >
            {analyticsScope.showWorkspaceAll ? (
              <option value="">{analyticsScope.workspaceAllLabel}</option>
            ) : null}
            {analyticsScope.workspaceOptions.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        ) : null}

        {analyticsScope.showSpaceFilter ? (
          <select
            className={cn(
              selectClass(),
              ((analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin) && !workspaceId) && 'opacity-50',
            )}
            value={spaceId}
            disabled={
              analyticsScope.isSpaceAdminOnly
                ? false
                : (analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin) && !workspaceId
            }
            onChange={(e) => handleSpaceChange(e.target.value)}
          >
            <option value="">
              {analyticsScope.orgLeader
                ? 'All spaces'
                : analyticsScope.isWorkspaceAdmin
                  ? 'All spaces'
                  : 'All my spaces'}
            </option>
            {visibleSpaces.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        ) : null}

        {analyticsScope.showProjectFilter ? (
          <select
            className={cn(
              selectClass(),
              ((analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin) && !workspaceId) && 'opacity-50',
            )}
            value={projectId}
            disabled={
              analyticsScope.lockProject ||
              ((analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin) && !workspaceId)
            }
            onChange={(e) => handleProjectChange(e.target.value)}
          >
            <option value="">
              {analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin
                ? 'All projects'
                : 'All my projects'}
            </option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : null}

        {analyticsScope.orgLeader || analyticsScope.isWorkspaceAdmin ? (
          <select
            className={cn(selectClass(), !workspaceId && 'opacity-50')}
            value={teamId}
            disabled={!workspaceId}
            onChange={(e) => { setTeamId(e.target.value); setPage(1) }}
          >
            <option value="">All teams</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        ) : null}

        <div className="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 px-1 py-0.5">
          <button
            className="rounded p-1 text-fg-secondary hover:bg-ink-750 hover:text-fg"
            onClick={() => setDate(toDateKey(addDays(new Date(date), -1)))}
            aria-label="Previous day"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-1 text-sm text-fg-secondary">{isToday ? 'Today' : date}</span>
          <button
            className="rounded p-1 text-fg-secondary enabled:hover:bg-ink-750 enabled:hover:text-fg disabled:opacity-40"
            onClick={() => setDate(toDateKey(addDays(new Date(date), 1)))}
            disabled={isToday}
            aria-label="Next day"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            className="w-56 rounded-lg border border-ink-700 bg-ink-850 py-1.5 pl-8 pr-3 text-sm text-fg placeholder:text-fg-muted focus:border-brand focus:outline-none"
            placeholder="Search people…"
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setPage(1) }}
          />
        </div>
      </div>

      {/* Summary cards */}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="mt-5 grid grid-cols-4 gap-3 max-lg:grid-cols-3 max-sm:grid-cols-2"
      >
        <GlassKpi label="Total Members" value={o?.total_members ?? 0} accent="#8C5BFF" />
        <GlassKpi label="Online" value={o?.online ?? 0} accent="#4CB782" />
        <GlassKpi label="Busy" value={o?.busy ?? 0} accent="#E5484D" />
        <GlassKpi label="Away" value={o?.away ?? 0} accent="#F2994A" />
        <GlassKpi label="Offline" value={o?.offline ?? 0} accent="#87909E" />
        <GlassKpi label="Avg Session" value={o ? durationLabel(o.average_session_duration) : '—'} accent="#26B5CE" />
        <GlassKpi label="Active Today" value={o?.active_users_today ?? 0} accent="#5B9FF0" />
      </motion.div>

      {/* Timeline + Status distribution */}
      <div className="mt-4 grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Panel
          className="col-span-2 max-lg:col-span-1"
          icon={<Activity size={14} />}
          title="Online Activity Timeline"
          subtitle="Users online over the day — spot peaks, lunch dips, and login trends"
        >
          {timeline.isLoading ? (
            <div className="py-16"><CenteredSpinner /></div>
          ) : (
            <TimelineChart points={timeline.data?.points ?? []} timeZone={timeline.data?.timezone || viewerTimezone} />
          )}
        </Panel>

        <Panel icon={<Users size={14} />} title="Status Distribution">
          {distribution.isLoading || !dist ? (
            <div className="py-16"><CenteredSpinner /></div>
          ) : (
            <StatusDonut slices={dist.slices} total={dist.total} />
          )}
        </Panel>
      </div>

      {/* Team activity comparison */}
      <Panel className="mt-4" icon={<BarChart3 size={14} />} title="Team Activity Comparison">
        <TeamComparison orgId={activeOrgId} tail={workspaceTail} />
      </Panel>

      {/* ---------- Phase 3: Historical insights ---------- */}
      <div className="mt-6 flex items-center gap-1.5">
        <TrendingUp size={15} className="text-brand" />
        <h2 className="text-sm font-bold text-fg">Historical Insights</h2>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          {TREND_PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setTrendDays(p.days)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                trendDays === p.days ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:text-fg',
              )}
            >
              <CalendarRange size={12} /> {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts */}
      <Panel className="mt-4" icon={<Bell size={14} />} title="Alerts">
        {alerts.isLoading ? (
          <div className="py-8"><CenteredSpinner /></div>
        ) : (
          <AlertsList alerts={alerts.data?.alerts ?? []} />
        )}
      </Panel>

      {/* Historical trends */}
      <Panel
        className="mt-4"
        icon={<LineChart size={14} />}
        title="Historical Trends"
        subtitle={`last ${trendDays} days`}
        action={
          trends.data ? (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-fg-muted">
                Peak <span className="font-semibold text-fg">{trends.data.peak_online}</span>
              </span>
              <span className="text-fg-muted">
                Avg active <span className="font-semibold text-fg">{trends.data.avg_active_users}</span>
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-semibold',
                  trends.data.growth.startsWith('-')
                    ? 'bg-rose-500/15 text-rose-400'
                    : 'bg-emerald-500/15 text-emerald-400',
                )}
              >
                {trends.data.growth}
              </span>
            </div>
          ) : undefined
        }
      >
        {trends.isLoading ? (
          <div className="py-16"><CenteredSpinner /></div>
        ) : (
          <TrendsChart points={trends.data?.points ?? []} timeZone={trends.data?.timezone || viewerTimezone} />
        )}
      </Panel>

      {/* Contribution heatmap + Device analytics */}
      <div className="mt-4 grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Panel className="col-span-2 max-lg:col-span-1" icon={<Grid3x3 size={14} />} title="Activity Heatmap">
          {contributionHeatmap.isLoading ? (
            <div className="py-16"><CenteredSpinner /></div>
          ) : (
            <ContributionHeatmap
              data={contributionHeatmap.data?.points ?? []}
              days={contributionHeatmap.data?.days ?? trendDays}
              timeZone={contributionHeatmap.data?.timezone || viewerTimezone}
              countLabel="active users"
            />
          )}
        </Panel>

        <Panel icon={<MonitorSmartphone size={14} />} title="Device Analytics">
          {devices.isLoading ? (
            <div className="py-16"><CenteredSpinner /></div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Devices</p>
                <DeviceBars
                  slices={devices.data?.devices ?? []}
                  totalSessions={devices.data?.total_sessions ?? 0}
                  showIcon
                />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Browsers</p>
                <DeviceBars
                  slices={devices.data?.browsers ?? []}
                  totalSessions={devices.data?.total_sessions ?? 0}
                />
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Presence table */}
      <Panel className="mt-4" icon={<UserCheck size={14} />} title="Employee Presence">
        {users.isLoading ? (
          <div className="py-12"><CenteredSpinner /></div>
        ) : !usersPage || usersPage.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-muted">No people match these filters.</p>
        ) : (
          <>
            <div className="max-h-80 overflow-auto pr-1">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wider text-fg-muted">
                    <Th>Member</Th>
                    <Th>Role</Th>
                    <Th>Workspace</Th>
                    <Th>Team</Th>
                    <Th>Status</Th>
                    <Th>Login</Th>
                    <Th>Last Seen</Th>
                    <Th>Session</Th>
                    <Th>Idle</Th>
                    <Th>Device</Th>
                    <Th>Browser</Th>
                  </tr>
                </thead>
                <tbody>
                  {usersPage.items.map((row) => (
                    <tr
                      key={row.user.id}
                      onClick={() => setSelectedUserId(row.user.id)}
                      className="cursor-pointer border-b border-ink-800/70 transition-colors hover:bg-white/[0.03]"
                    >
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            name={row.user.full_name || row.user.email}
                            src={row.user.avatar_url}
                            color={row.user.avatar_color}
                            size={30}
                            userId={row.user.id}
                            showPresence
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-fg">{row.user.full_name || '—'}</p>
                            <p className="truncate text-xs text-fg-muted">{row.user.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="capitalize text-fg-secondary">{row.role ?? '—'}</Td>
                      <Td className="text-fg-secondary">{listLabel(row.workspaces)}</Td>
                      <Td className="text-fg-secondary">{listLabel(row.teams)}</Td>
                      <Td><StatusPill status={row.status as PresenceStatus} /></Td>
                      <Td className="text-fg-secondary">{row.login_time ? formatDateTimeInTimezone(row.login_time, viewerTimezone) : '—'}</Td>
                      <Td className="text-fg-secondary">{row.last_seen ? timeAgo(row.last_seen) : '—'}</Td>
                      <Td className="font-mono text-fg-secondary">{durationLabel(row.session_duration)}</Td>
                      <Td className="font-mono text-fg-secondary">{durationLabel(row.idle_time)}</Td>
                      <Td className="text-fg-secondary">{row.device ?? '—'}</Td>
                      <Td className="text-fg-secondary">{row.browser ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between text-xs text-fg-muted">
                <span>{usersPage.total} {usersPage.total === 1 ? 'person' : 'people'}</span>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-ink-700 px-2 py-1 enabled:hover:border-ink-600 enabled:hover:text-fg disabled:opacity-40"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Prev
                  </button>
                  <span>Page {page} / {totalPages}</span>
                  <button
                    className="rounded-lg border border-ink-700 px-2 py-1 enabled:hover:border-ink-600 enabled:hover:text-fg disabled:opacity-40"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      {/* Recent presence activity */}
      <Panel className="mt-4" icon={<Clock size={14} />} title="Recent Presence Activity">
        {activity.isLoading ? (
          <div className="py-8"><CenteredSpinner /></div>
        ) : (
          <ActivityFeed items={activity.data ?? []} />
        )}
      </Panel>

      {selectedUserId && (
        <EmployeeDetailDrawer
          orgId={org?.id}
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  )
}

/** Page through every matching presence row for export (backend caps page_size at 200). */
async function fetchAllPresence(orgId: string, usersTail: string) {
  // Strip page/page_size from the shared tail, then request large pages.
  const base = usersTail.replace(/&page=\d+/g, '').replace(/&page_size=\d+/g, '')
  const rows: PresenceUsersPage['items'] = []
  let page = 1
  for (;;) {
    const res = await api.get<PresenceUsersPage>(
      `/analytics/users?organization_id=${orgId}${base}&page=${page}&page_size=200`,
    )
    rows.push(...res.items)
    if (rows.length >= res.total || res.items.length === 0) break
    page += 1
    if (page > 50) break // safety
  }
  return rows
}

function listLabel(items: string[]): string {
  if (items.length === 0) return '—'
  if (items.length <= 2) return items.join(', ')
  return `${items.slice(0, 2).join(', ')} +${items.length - 2}`
}

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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 font-semibold">{children}</th>
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('whitespace-nowrap px-3 py-2.5 align-middle', className)}>{children}</td>
}
