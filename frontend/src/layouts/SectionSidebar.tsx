import {
  Activity,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  Grid3x3,
  GitBranch,
  LayoutGrid,
  List,
  Plus,
  Presentation,
  SquareCheck,
  Trophy,
  User as UserIcon,
  Users,
} from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  GitHubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleSheetsIcon,
  OutlookIcon,
} from '../components/icons/brands'
import { api } from '../lib/api'
import {
  useCurrentContext,
  useForms,
  useGoals,
  useGoalsAccess,
  useTeams,
  useUserRoles,
  useWhiteboards,
  useWorkspaceMembers,
} from '../lib/queries'
import { canCreateGoal, canAccessGoalsSection, canAccessGoals } from '../lib/createAccess'
import { canAccessAnalytics } from '../lib/roleHierarchy'
import type { CalendarEvent } from '../lib/types'
import { cn, timeAgo } from '../lib/utils'
import { useRealtime } from '../lib/ws'
import { startGoogleConnect, useCalendarStatus } from '../lib/googleCalendar'
import { usePeopleScope } from '../hooks/usePeopleScope'
import { useAuthStore } from '../stores/auth'
import { toast } from '../stores/toast'
import type { SectionKey } from '../stores/ui'
import { DocsSidebar } from '../modules/docs/components/DocsSidebar'
import { SecondarySidebar } from '../components/layout/SecondarySidebar'
import { SidebarCollapseButton } from '../components/layout/SidebarCollapseButton'
import { Sidebar as HomeSidebar } from './Sidebar'

export type { SectionKey }

export function sectionFromPath(pathname: string): SectionKey {
  if (pathname.startsWith('/app/planner')) return 'planner'
  // My Analytics is a Home shortcut — keep Home sidebar active (not Planner).
  if (pathname.startsWith('/app/my-analytics')) return 'home'
  if (pathname.startsWith('/app/goals')) return 'goals'
  if (pathname.startsWith('/app/teams')) return 'teams'
  if (pathname.startsWith('/app/analytics')) return 'teams'
  if (pathname.startsWith('/app/docs')) return 'docs'
  if (pathname.startsWith('/app/whiteboards')) return 'whiteboards'
  if (pathname.startsWith('/app/forms')) return 'forms'
  if (pathname.startsWith('/app/timesheet')) return 'timesheet'
  if (pathname.startsWith('/app/apps')) return 'apps'
  return 'home'
}

export function SectionSidebar({ section }: { section: SectionKey }) {
  const { org, workspace } = useCurrentContext()
  const { data: userRoles } = useUserRoles()
  const goalsAccessQuery = useGoalsAccess(workspace?.id)
  const goalsAccess = canAccessGoals(
    canAccessGoalsSection(org, workspace, userRoles, workspace?.id),
    goalsAccessQuery.data,
  )

  switch (section) {
    case 'planner':
      return <PlannerSidebar />
    case 'goals':
      return goalsAccess ? <GoalsSidebar sharedOnly={!canAccessGoalsSection(org, workspace, userRoles, workspace?.id)} /> : (
        <HomeSidebar />
      )
    case 'teams':
      return <TeamsSidebar />
    case 'docs':
      return <DocsSidebar />
    case 'whiteboards':
      return <WhiteboardsSidebar />
    case 'forms':
      return <FormsSidebar />
    case 'timesheet':
      return <TimesheetSidebar />
    case 'apps':
      return <AppsSidebar />
    default:
      return <HomeSidebar />
  }
}

/* ---------------- shared bits ---------------- */

function Shell({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <SecondarySidebar className="overflow-y-auto pb-4">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-fg">{title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          <SidebarCollapseButton />
        </div>
      </div>
      {children}
    </SecondarySidebar>
  )
}

function Item({
  to,
  icon,
  label,
  badge,
  end,
}: {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number | string
  end?: boolean
}) {
  const location = useLocation()
  const [path, query] = to.split('?')
  const currentParams = new URLSearchParams(location.search)
  const targetParams = new URLSearchParams(query ?? '')
  const pathMatches = end ? location.pathname === path : location.pathname.startsWith(path)
  const queryMatches = query
    ? currentParams.toString() === targetParams.toString()
    : !end || currentParams.toString() === ''
  const isActive = pathMatches && queryMatches

  return (
    <Link
      to={to}
      className={cn(
        'mx-2 flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
        isActive ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {badge != null && badge !== 0 && (
        <span className="text-[11px] text-fg-muted">{badge}</span>
      )}
    </Link>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </p>
  )
}

function CreateButton({ to }: { to: string }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(to)}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink-700 bg-ink-800 text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
      title="Create"
    >
      <Plus size={14} />
    </button>
  )
}

/* ---------------- Planner (calendar integration) ---------------- */

function PlannerSidebar() {
  const status = useCalendarStatus()
  const google = status.data?.google
  const navigate = useNavigate()

  const events = useQuery({
    queryKey: ['calendar-events'],
    queryFn: () => api.get<CalendarEvent[]>('/calendar/events?days=7'),
    enabled: !!google?.connected,
    retry: false,
  })

  return (
    <Shell title="Planner">
      {!google?.connected ? (
        <div className="mx-3 mt-6 flex flex-col items-center rounded-2xl border border-ink-700 bg-ink-900 px-4 py-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-800">
            <CalendarDays size={26} className="text-fg-muted" />
          </span>
          <p className="mt-4 text-sm leading-relaxed text-fg-secondary">
            Connect your calendar to view upcoming events and plan your work
          </p>
          <div className="mt-5 w-full space-y-2.5">
            <button
              type="button"
              onClick={() => {
                if (google?.configured) {
                  void startGoogleConnect('calendar')
                  return
                }
                toast.error(
                  'Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then try again.',
                )
                navigate('/app/planner')
              }}
              className="flex w-full items-center gap-2.5 rounded-xl border border-ink-600/80 bg-ink-850 px-3.5 py-3 text-sm font-semibold text-fg shadow-[0_3px_10px_rgba(0,0,0,0.16)] transition-all hover:-translate-y-0.5 hover:border-ink-500 hover:shadow-[0_6px_16px_rgba(0,0,0,0.2)]"
            >
              <GoogleCalendarIcon size={18} />
              <span className="flex-1 text-left">Google Calendar</span>
            </button>
            <div
              className="flex w-full items-center gap-2.5 rounded-xl border border-ink-600/80 bg-ink-850 px-3.5 py-3 text-sm font-semibold text-fg shadow-[0_3px_10px_rgba(0,0,0,0.16)]"
              title="Microsoft Outlook is coming soon"
              aria-disabled
            >
              <OutlookIcon size={18} />
              <span className="flex-1 text-left">Microsoft Outlook</span>
              <span className="rounded-md bg-ink-750 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                Coming soon
              </span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <SectionLabel>Upcoming</SectionLabel>
          {(events.data ?? []).slice(0, 6).map((event) => (
            <div key={event.id} className="mx-2 flex items-center gap-2 rounded-lg px-3 py-1.5">
              <span className="h-4 w-1 shrink-0 rounded-full bg-brand" />
              <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">{event.summary}</span>
              <span className="shrink-0 font-mono text-[10px] text-fg-muted">
                {event.all_day
                  ? 'all day'
                  : new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          ))}
          {(events.data ?? []).length === 0 && (
            <p className="px-5 py-2 text-xs text-fg-muted">No events in the next 7 days</p>
          )}
        </>
      )}
      <SectionLabel>My work</SectionLabel>
      <Item to="/app/my-tasks/assigned" end icon={<SquareCheck size={15} />} label="My Tasks" />
      <Item to="/app/my-tasks/today-overdue" icon={<CalendarClock size={15} />} label="Today & Overdue" />
      <Item to="/app/my-tasks/personal" icon={<List size={15} />} label="Personal List" />
      <Item to="/app/my-tasks/assigned?due=week" icon={<CalendarDays size={15} />} label="Due this week" />
      <Item to="/app/sprints" icon={<GitBranch size={15} />} label="Sprints" />
    </Shell>
  )
}

/* ---------------- Goals ---------------- */

function GoalsSidebar({ sharedOnly = false }: { sharedOnly?: boolean }) {
  const { org, workspace } = useCurrentContext()
  const { data: userRoles } = useUserRoles()
  const queryClient = useQueryClient()
  const goals = useGoals(workspace?.id, true)
  const canCreate = canCreateGoal(org, workspace, userRoles, workspace?.id)
  const recent = (goals.data ?? []).slice(0, 8)

  useRealtime('goal.updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['goals', workspace?.id] })
  }, [workspace?.id])

  return (
    <Shell title="Goals" action={canCreate ? <CreateButton to="/app/goals?new=1" /> : undefined}>
      <Item
        to="/app/goals"
        end
        icon={<Trophy size={15} />}
        label={sharedOnly ? 'Shared with me' : 'All Goals'}
        badge={goals.data?.length}
      />
      <SectionLabel>Recent</SectionLabel>
      {recent.map((goal) => (
        <Item
          key={goal.id}
          to={`/app/goals?goal=${goal.id}`}
          icon={<Trophy size={15} className="text-amber-400" />}
          label={goal.name}
        />
      ))}
      {(goals.data ?? []).length === 0 && (
        <p className="px-5 py-2 text-xs text-fg-muted">No goals yet</p>
      )}
    </Shell>
  )
}

/* ---------------- Teams ---------------- */

function TeamsSidebar() {
  const { workspace } = useCurrentContext()
  const teams = useTeams(workspace?.id)
  const { members, hasPeopleAdminAccess } = usePeopleScope()
  const user = useAuthStore((s) => s.user)
  const { data: userRoles } = useUserRoles()
  const canSeeAnalytics = canAccessAnalytics(userRoles?.highest_role)

  const myTeams = (teams.data ?? []).filter((t) => t.members.some((m) => m.id === user?.id))

  return (
    <Shell title="Teams" action={<CreateButton to="/app/teams?new=1" />}>
      <Item to="/app/teams" end icon={<Users size={15} />} label="All Teams" badge={teams.data?.length} />
      {hasPeopleAdminAccess && (
        <Item
          to="/app/teams?tab=people"
          icon={<UserIcon size={15} />}
          label="All People"
          badge={members.length}
        />
      )}
      {canSeeAnalytics && (
        <Item to="/app/analytics" end icon={<Activity size={15} />} label="Analytics" />
      )}
      <SectionLabel>My Teams</SectionLabel>
      {myTeams.map((team) => (
        <Item
          key={team.id}
          to={`/app/teams?team=${team.id}`}
          icon={
            <span
              className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
              style={{ backgroundColor: team.color }}
            >
              {team.name[0]?.toUpperCase()}
            </span>
          }
          label={team.name}
          badge={team.members.length}
        />
      ))}
      {myTeams.length === 0 && (
        <p className="px-5 py-2 text-xs text-fg-muted">Once you join or create a Team you will see it here</p>
      )}
    </Shell>
  )
}

/* ---------------- Whiteboards ---------------- */

function WhiteboardsSidebar() {
  const { workspace } = useCurrentContext()
  const queryClient = useQueryClient()
  const boards = useWhiteboards(workspace?.id)
  const user = useAuthStore((s) => s.user)
  const mine = (boards.data ?? []).filter((b) => b.created_by === user?.id)
  const recents = (boards.data ?? []).slice(0, 5)

  useRealtime(
    ['whiteboard.created', 'whiteboard.updated', 'whiteboard.deleted'],
    () => void queryClient.invalidateQueries({ queryKey: ['whiteboards', workspace?.id] }),
    [workspace?.id],
  )

  return (
    <Shell title="Whiteboards" action={<CreateButton to="/app/whiteboards?new=1" />}>
      <Item to="/app/whiteboards" end icon={<Presentation size={15} />} label="All Whiteboards" badge={boards.data?.length} />
      <Item to="/app/whiteboards?mine=1" icon={<UserIcon size={15} />} label="My Whiteboards" badge={mine.length} />
      <SectionLabel>Recents</SectionLabel>
      {recents.map((board) => (
        <Item
          key={board.id}
          to={`/app/whiteboards/${board.id}`}
          icon={<Presentation size={15} className="text-amber-400" />}
          label={board.name}
          badge={timeAgo(board.updated_at)}
        />
      ))}
      {recents.length === 0 && <p className="px-5 py-2 text-xs text-fg-muted">No whiteboards yet</p>}
    </Shell>
  )
}

/* ---------------- Forms ---------------- */

function FormsSidebar() {
  const { org, workspace } = useCurrentContext()
  const forms = useForms(workspace?.id)
  const members = useWorkspaceMembers(workspace?.id)
  const user = useAuthStore((s) => s.user)
  const mine = (forms.data ?? []).filter((f) => f.created_by === user?.id)
  const currentMemberRole = members.data?.find((member) => member.user_id === user?.id)?.role
  const canManageForms =
    (org?.my_role === 'owner' || org?.my_role === 'admin') ||
    workspace?.my_role === 'owner' ||
    workspace?.my_role === 'admin' ||
    currentMemberRole === 'owner' ||
    currentMemberRole === 'admin'

  return (
    <Shell title="Forms" action={canManageForms ? <CreateButton to="/app/forms?new=1" /> : undefined}>
      <Item to="/app/forms" end icon={<ClipboardCheck size={15} />} label="All Forms" badge={forms.data?.length} />
      <Item to="/app/forms?mine=1" icon={<UserIcon size={15} />} label="My Forms" badge={mine.length} />
      <SectionLabel>Recent</SectionLabel>
      {(forms.data ?? []).slice(0, 5).map((form) => (
        <Item
          key={form.id}
          to={canManageForms ? `/app/forms/${form.id}` : `/app/forms/${form.id}/fill`}
          icon={<ClipboardCheck size={15} className="text-emerald-400" />}
          label={form.name}
          badge={form.submission_count}
        />
      ))}
      {(forms.data ?? []).length === 0 && <p className="px-5 py-2 text-xs text-fg-muted">No forms yet</p>}
    </Shell>
  )
}

/* ---------------- Timesheet ---------------- */

function TimesheetSidebar() {
  return (
    <Shell title="Timesheets">
      <Item to="/app/timesheet" end icon={<LayoutGrid size={15} />} label="My timesheet" />
      <Item to="/app/timesheet?tab=entries" icon={<List size={15} />} label="Time entries" />
      <SectionLabel>Actions</SectionLabel>
      <Item to="/app/timesheet?new=1" icon={<Plus size={15} />} label="Create Entry" />
    </Shell>
  )
}

/* ---------------- Apps ---------------- */

function AppsSidebar() {
  return (
    <Shell title="App Center">
      <SectionLabel>Integrations</SectionLabel>
      <Item to="/app/apps" end icon={<Grid3x3 size={15} />} label="All Apps" />
      <Item
        to="/app/apps?app=github"
        icon={<GitHubIcon size={15} className="text-fg" />}
        label="GitHub"
      />
      <Item to="/app/apps?q=calendar" icon={<GoogleCalendarIcon size={15} />} label="Google Calendar" />
      <Item to="/app/apps?q=gmail" icon={<GmailIcon size={15} />} label="Gmail" />
      <Item to="/app/apps?q=sheets" icon={<GoogleSheetsIcon size={15} />} label="Google Sheets" />
    </Shell>
  )
}
