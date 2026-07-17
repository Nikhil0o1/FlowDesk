import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  FolderKanban,
  History,
  LayoutGrid,
  List,
  PieChart,
  Plus,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import OrgAdminDashboard from '../../components/dashboard/OrgAdminDashboard'
import OrgOwnerDashboard from '../../components/dashboard/OrgOwnerDashboard'
import ProjectAdminDashboard from '../../components/dashboard/ProjectAdminDashboard'
import ProjectMemberDashboard from '../../components/dashboard/ProjectMemberDashboard'
import SpaceAdminDashboard from '../../components/dashboard/SpaceAdminDashboard'
import WorkspaceAdminDashboard from '../../components/dashboard/WorkspaceAdminDashboard'
import { AdminScopeSwitcher } from '../../components/dashboard/AdminScopeSwitcher'
import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects, useSpaces, useUserRoles } from '../../lib/queries'
import { adminWorkspaceRoles, dashboardViewsForWorkspace } from '../../lib/scopedRoles'
import { RecentListRow } from '../../components/recents/RecentListRow'
import { getRecents, RECENTS_UPDATED_EVENT, type RecentItem } from '../../lib/recents'
import type { Workspace, WorkspaceTaskStats } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { EmptyState } from '../../components/ui/EmptyState'
import { CenteredSpinner } from '../../components/ui/Spinner'

const NO_SCOPES: { id: string; label: string; meta?: string }[] = []
const noopScope = () => {}

export default function DashboardPage() {
  const { org, workspace, isLoading } = useCurrentContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: roles, isLoading: rolesLoading } = useUserRoles()
  const [activeViewKey, setActiveViewKey] = useState<string | null>(null)

  // Which dashboards this user holds inside the CURRENTLY selected workspace. Switching
  // workspace (top bar) recomputes this; the in-dashboard switcher moves between the
  // roles/projects held within this one workspace.
  const views = useMemo(
    () => dashboardViewsForWorkspace(roles, workspace?.id),
    [roles, workspace?.id],
  )
  const activeView = views.find((v) => v.key === activeViewKey) ?? views[0] ?? null
  const adminWorkspaceCount = useMemo(
    () => (roles ? adminWorkspaceRoles(roles).length : 0),
    [roles],
  )

  useEffect(() => {
    const id = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: ['spaces'] })
      void queryClient.invalidateQueries({ queryKey: ['workspace-task-stats'] })
      void queryClient.invalidateQueries({ queryKey: ['org-dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['workspace-dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['space-dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['project-dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['project-member-dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['user-roles'] })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [queryClient])

  if (isLoading || rolesLoading) return <CenteredSpinner />

  if (!workspace) {
    const isOwner = org?.my_role === 'owner' || org?.my_role === 'admin'
    return (
      <div className="flex h-full items-center justify-center px-8">
        <EmptyState
          icon={LayoutGrid}
          title={org ? `Welcome to ${org.name}` : 'No workspace yet'}
          description={
            isOwner
              ? 'Create your first workspace — it holds your spaces, projects, sprints and chat.'
              : 'You are not in any workspace yet. Ask your organization owner to add you to one.'
          }
          action={
            isOwner ? (
              <button className="btn-primary" onClick={() => navigate('/app/workspaces?new=1')}>
                <Plus size={14} /> Create your first workspace
              </button>
            ) : undefined
          }
        />
      </div>
    )
  }

  // The dashboard body for the active view. Org leaders always resolve to the org
  // dashboard; everyone else gets the dashboard for their role in this workspace.
  let body: React.ReactNode = null
  if (activeView?.kind === 'org_owner' && org) {
    body = <OrgOwnerDashboard orgId={org.id} />
  } else if (activeView?.kind === 'org_admin' && org) {
    body = <OrgAdminDashboard orgId={org.id} />
  } else if (activeView?.kind === 'workspace_admin' && activeView.scopeId) {
    body = <WorkspaceAdminDashboard workspaceId={activeView.scopeId} adminWorkspaceCount={adminWorkspaceCount} />
  } else if (activeView?.kind === 'space_admin' && activeView.scopeId) {
    body = (
      <SpaceAdminDashboard
        spaceId={activeView.scopeId}
        scopeOptions={NO_SCOPES}
        scopeId={activeView.scopeId}
        onScopeChange={noopScope}
      />
    )
  } else if (activeView?.kind === 'project_admin' && activeView.scopeId) {
    body = (
      <ProjectAdminDashboard
        projectId={activeView.scopeId}
        scopeOptions={NO_SCOPES}
        scopeId={activeView.scopeId}
        onScopeChange={noopScope}
      />
    )
  } else if (
    (activeView?.kind === 'project_member' || activeView?.kind === 'project_viewer') &&
    activeView.scopeId
  ) {
    body = (
      <ProjectMemberDashboard
        projectId={activeView.scopeId}
        scopeOptions={NO_SCOPES}
        scopeId={activeView.scopeId}
        onScopeChange={noopScope}
      />
    )
  }

  if (body === null) {
    // No role-specific dashboard for this workspace → generic overview.
    return <GenericWorkspaceOverview workspace={workspace} />
  }

  // More than one dashboard in this workspace → show a switcher to move between them.
  if (views.length > 1) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2.5 border-b border-ink-700 px-6 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Viewing as
          </span>
          <AdminScopeSwitcher
            options={views.map((v) => ({ id: v.key, label: v.label, meta: v.scopeName ?? undefined }))}
            value={activeView?.key ?? ''}
            onChange={setActiveViewKey}
            menuHeading="Your dashboards in this workspace"
          />
        </div>
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    )
  }

  return <div className="h-full min-h-0">{body}</div>
}

/** Generic workspace overview shown when a user has no role-specific dashboard here. */
function GenericWorkspaceOverview({ workspace }: { workspace: Workspace }) {
  return (
    <div className="mx-auto max-w-7xl px-8 py-6">
      <ConnectGoogleBanner />

      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white"
          style={{ backgroundColor: workspace.color }}
        >
          {workspace.name[0]?.toUpperCase()}
        </span>
        <h1 className="text-lg font-bold text-fg">{workspace.name}</h1>
        <span className="rounded bg-ink-750 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-secondary">
          Overview
        </span>
      </div>

      {/* Cards */}
      <div className="mt-5 grid grid-cols-2 gap-5 max-lg:grid-cols-1">
        <RecentCard />
        <WorkloadCard workspaceId={workspace.id} />
        <ListsCard className="col-span-2 max-lg:col-span-1" />
        <SpacesCard className="col-span-2 max-lg:col-span-1" />
      </div>
    </div>
  )
}

/** One-time nudge to finish the Google Workspace consent (Calendar/Gmail/Sheets).
 *  Sign-in only proves identity; the API scopes need their own consent. */
function ConnectGoogleBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('google-connect-dismissed') === '1',
  )
  const status = useQuery({
    queryKey: ['google-status'],
    queryFn: () =>
      api.get<{ configured: boolean; connected: boolean }>('/integrations/google/status'),
    staleTime: 5 * 60_000,
  })

  if (dismissed || !status.data?.configured || status.data.connected) return null

  const connect = async () => {
    try {
      const { url } = await api.get<{ url: string }>('/calendar/google/auth-url?next=apps')
      window.location.href = url
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-brand/40 bg-brand-soft px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-fg">
        <span className="font-semibold">Connect your Google account</span>
        <span className="text-fg-secondary">
          {' '}
          — one approval enables your Calendar in the Planner, invites from your Gmail, task emails
          and Sheets export.
        </span>
      </p>
      <button className="btn-primary !py-1.5 text-xs" onClick={() => void connect()}>
        Connect
      </button>
      <button
        className="text-fg-muted hover:text-fg"
        title="Dismiss"
        onClick={() => {
          localStorage.setItem('google-connect-dismissed', '1')
          setDismissed(true)
        }}
      >
        <X size={15} />
      </button>
    </div>
  )
}

/* ---------------- shared card shell ---------------- */

function Card({
  icon,
  title,
  className,
  children,
}: {
  icon: React.ReactNode
  title: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('overflow-hidden rounded-2xl border border-ink-700 bg-ink-850/40', className)}>
      <header className="flex items-center gap-2 px-5 pb-1 pt-4">
        <span className="text-fg-secondary">{icon}</span>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
      </header>
      <div className="px-3 pb-4 pt-1">{children}</div>
    </section>
  )
}

/* ---------------- Recent ---------------- */

function RecentCard() {
  const [recents, setRecents] = useState<RecentItem[]>(() => getRecents())

  useEffect(() => {
    const refresh = () => setRecents(getRecents())
    window.addEventListener(RECENTS_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(RECENTS_UPDATED_EVENT, refresh)
  }, [])

  return (
    <Card icon={<History size={14} />} title="Recent">
      {recents.length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-fg-muted">
          Projects and tasks you open will show up here.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {recents.slice(0, 7).map((item) => (
            <RecentListRow key={`${item.type}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ---------------- Workload by Status (donut) ---------------- */

function WorkloadCard({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['workspace-task-stats', workspaceId],
    queryFn: () => api.get<WorkspaceTaskStats>(`/workspaces/${workspaceId}/task-stats`),
  })

  return (
    <Card icon={<PieChart size={14} />} title="Workload by Status">
      {isLoading ? (
        <CenteredSpinner />
      ) : !data || data.total === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-fg-muted">No open tasks yet.</p>
      ) : (
        <div className="flex items-center gap-8 px-3 py-2">
          <Donut stats={data} />
          <div className="min-w-0 flex-1 space-y-1.5">
            {data.by_status.map((status) => (
              <div key={status.name} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
                <span className="min-w-0 flex-1 truncate text-fg-secondary">{status.name}</span>
                <span className="font-mono text-xs text-fg">{status.count}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 border-t border-ink-700 pt-1.5 text-sm">
              <span className="flex-1 text-fg-secondary">Total</span>
              <span className="font-mono text-xs font-semibold text-fg">{data.total}</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function Donut({ stats }: { stats: WorkspaceTaskStats }) {
  const size = 150
  const stroke = 26
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0">
      {stats.by_status.map((status) => {
        const fraction = status.count / stats.total
        const dash = fraction * circumference
        const el = (
          <circle
            key={status.name}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={status.color}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
          />
        )
        offset += dash
        return el
      })}
    </svg>
  )
}

/* ---------------- Lists (projects with progress) ---------------- */

function ListsCard({ className }: { className?: string }) {
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const spaces = useSpaces(workspace?.id)
  const navigate = useNavigate()

  return (
    <Card icon={<List size={14} />} title="Lists" className={className}>
      {projects.isLoading ? (
        <CenteredSpinner />
      ) : (projects.data ?? []).length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-fg-muted">No projects you can see yet.</p>
      ) : (
        <div>
          <div
            className="grid items-center gap-2 px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted"
            style={{ gridTemplateColumns: 'minmax(200px,1.5fr) minmax(160px,1fr) 70px 90px 20px' }}
          >
            <span>Name</span>
            <span>Progress</span>
            <span className="text-right">Done</span>
            <span>Space</span>
            <span />
          </div>
          {(projects.data ?? []).map((project) => {
            const total = project.task_count ?? 0
            const done = project.done_task_count ?? 0
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            const space = spaces.data?.find((s) => s.id === project.space_id)
            return (
              <button
                key={project.id}
                onClick={() => navigate(`/app/projects/${project.id}`)}
                className="group grid w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-ink-800"
                style={{ gridTemplateColumns: 'minmax(200px,1.5fr) minmax(160px,1fr) 70px 90px 20px' }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FolderKanban size={14} className="shrink-0" style={{ color: project.color }} />
                  <span className="truncate text-sm text-fg">{project.name}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right font-mono text-[11px] text-fg-muted">{pct}%</span>
                </span>
                <span className="text-right font-mono text-xs text-fg-secondary">
                  {done}/{total}
                </span>
                <span className="truncate text-xs text-fg-muted">{space?.name ?? '—'}</span>
                <ChevronRight size={13} className="text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/* ---------------- Spaces (folders) ---------------- */

function SpacesCard({ className }: { className?: string }) {
  const { workspace } = useCurrentContext()
  const spaces = useSpaces(workspace?.id)
  const projects = useProjects(workspace?.id)
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const canManage = workspace?.my_role === 'admin' || workspace?.my_role === 'owner'

  const create = async () => {
    if (!workspace || !name.trim()) return
    try {
      await api.post(`/workspaces/${workspace.id}/spaces`, { name: name.trim() })
      toast.success('Space created')
      setName('')
      setAdding(false)
      void queryClient.invalidateQueries({ queryKey: ['spaces', workspace.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card icon={<LayoutGrid size={14} />} title="Spaces" className={className}>
      {(spaces.data ?? []).length === 0 && !adding ? (
        <div className="flex flex-col items-center gap-3 px-2 py-8">
          <p className="text-sm text-fg-muted">Organize projects into Spaces.</p>
          {canManage && (
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add Space
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 px-2 max-md:grid-cols-2">
          {(spaces.data ?? []).map((space) => {
            const count = (projects.data ?? []).filter((p) => p.space_id === space.id).length
            return (
              <div key={space.id} className="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                  style={{ backgroundColor: space.color }}
                >
                  {space.name[0]?.toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{space.name}</span>
                  <span className="block text-[11px] text-fg-muted">
                    {count} project{count === 1 ? '' : 's'}
                  </span>
                </span>
              </div>
            )
          })}
          {canManage &&
            (adding ? (
              <div className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-900 px-3 py-3">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create()
                    if (e.key === 'Escape') setAdding(false)
                  }}
                  onBlur={() => !name.trim() && setAdding(false)}
                  placeholder="Space name"
                  className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
                />
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink-600 px-3.5 py-3 text-sm text-fg-muted transition-colors hover:border-fg-muted hover:text-fg-secondary"
              >
                <Plus size={14} /> Add Space
              </button>
            ))}
        </div>
      )}
    </Card>
  )
}
