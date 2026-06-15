import {
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Grid3x3,
  GitBranch,
  LayoutGrid,
  List,
  Plus,
  Presentation,
  SquareCheck,
  User as UserIcon,
  Users,
} from 'lucide-react'
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom'

import { useQuery } from '@tanstack/react-query'

import {
  GitHubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleSheetsIcon,
  OutlookIcon,
} from '../components/icons/brands'
import { api } from '../lib/api'
import { useCurrentContext, useForms, useTeams, useWhiteboards, useWorkspaceMembers } from '../lib/queries'
import type { CalendarEvent } from '../lib/types'
import { cn, timeAgo } from '../lib/utils'
import { startGoogleConnect, useCalendarStatus } from '../pages/app/PlannerPage'
import { useAuthStore } from '../stores/auth'
import type { SectionKey } from '../stores/ui'
import { Sidebar as HomeSidebar } from './Sidebar'

export type { SectionKey }

export function sectionFromPath(pathname: string): SectionKey {
  if (pathname.startsWith('/app/planner')) return 'planner'
  if (pathname.startsWith('/app/teams')) return 'teams'
  if (pathname.startsWith('/app/whiteboards')) return 'whiteboards'
  if (pathname.startsWith('/app/forms')) return 'forms'
  if (pathname.startsWith('/app/timesheet')) return 'timesheet'
  if (pathname.startsWith('/app/apps')) return 'apps'
  return 'home'
}

export function SectionSidebar({ section }: { section: SectionKey }) {
  switch (section) {
    case 'planner':
      return <PlannerSidebar />
    case 'teams':
      return <TeamsSidebar />
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
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-ink-700 bg-ink-850 pb-4">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-lg font-bold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </aside>
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
  const [params] = useSearchParams()
  // NavLink active matching ignores query strings; compare manually when `to` has one
  const [path, query] = to.split('?')
  const isQueryMatch = () => {
    if (!query) return true
    const target = new URLSearchParams(query)
    for (const [key, value] of target.entries()) {
      if (params.get(key) !== value) return false
    }
    return true
  }
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'mx-2 flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
          isActive && isQueryMatch()
            ? 'bg-brand-soft text-fg'
            : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
        )
      }
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {badge != null && badge !== 0 && (
        <span className="text-[11px] text-fg-muted">{badge}</span>
      )}
    </NavLink>
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
          <div className="mt-5 w-full space-y-2">
            <button
              onClick={() => {
                if (google?.configured) void startGoogleConnect()
                else navigate('/app/planner')
              }}
              className="flex w-full items-center gap-2.5 rounded-xl bg-ink-800 px-3.5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-ink-750"
            >
              <GoogleCalendarIcon size={16} />
              <span className="flex-1 text-left">Google Calendar</span>
              <span className="rounded-lg bg-ink-700 px-2.5 py-1 text-xs text-fg-secondary">Connect</span>
            </button>
            <button
              onClick={() => navigate('/app/planner')}
              className="flex w-full items-center gap-2.5 rounded-xl bg-ink-800 px-3.5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-ink-750"
            >
              <OutlookIcon size={16} />
              <span className="flex-1 text-left">Microsoft Outlook</span>
              <span className="rounded-lg bg-ink-700 px-2.5 py-1 text-xs text-fg-secondary">Connect</span>
            </button>
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
      <Item to="/app/list" end icon={<SquareCheck size={15} />} label="My Tasks" />
      <Item to="/app/list?due=today" icon={<CalendarClock size={15} />} label="Today" />
      <Item to="/app/list?due=week" icon={<CalendarDays size={15} />} label="This week" />
      <Item to="/app/list?due=overdue" icon={<Clock size={15} className="text-red-400" />} label="Overdue" />
      <Item to="/app/sprints" icon={<GitBranch size={15} />} label="Sprints" />
    </Shell>
  )
}

/* ---------------- Teams ---------------- */

function TeamsSidebar() {
  const { workspace } = useCurrentContext()
  const teams = useTeams(workspace?.id)
  const members = useWorkspaceMembers(workspace?.id)
  const user = useAuthStore((s) => s.user)

  const myTeams = (teams.data ?? []).filter((t) => t.members.some((m) => m.id === user?.id))

  return (
    <Shell title="Teams" action={<CreateButton to="/app/teams?new=1" />}>
      <Item to="/app/teams" end icon={<Users size={15} />} label="All Teams" badge={teams.data?.length} />
      <Item to="/app/teams?tab=people" icon={<UserIcon size={15} />} label="All People" badge={members.data?.length} />
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
  const boards = useWhiteboards(workspace?.id)
  const user = useAuthStore((s) => s.user)
  const mine = (boards.data ?? []).filter((b) => b.created_by === user?.id)
  const recents = (boards.data ?? []).slice(0, 5)

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
  const { workspace } = useCurrentContext()
  const forms = useForms(workspace?.id)
  const user = useAuthStore((s) => s.user)
  const mine = (forms.data ?? []).filter((f) => f.created_by === user?.id)

  return (
    <Shell title="Forms" action={<CreateButton to="/app/forms?new=1" />}>
      <Item to="/app/forms" end icon={<ClipboardCheck size={15} />} label="All Forms" badge={forms.data?.length} />
      <Item to="/app/forms?mine=1" icon={<UserIcon size={15} />} label="My Forms" badge={mine.length} />
      <SectionLabel>Recent</SectionLabel>
      {(forms.data ?? []).slice(0, 5).map((form) => (
        <Item
          key={form.id}
          to={`/app/forms/${form.id}`}
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
      <Item to="/app/apps?q=docs" icon={<GoogleDocsIcon size={15} />} label="Google Docs" />
    </Shell>
  )
}
