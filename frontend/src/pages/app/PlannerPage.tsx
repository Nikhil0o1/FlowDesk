import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, CalendarDays, CheckCircle2, ExternalLink, RefreshCw, Unplug } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { CalendarEvent, CalendarStatus, Page, Task } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { GoogleCalendarIcon, OutlookIcon } from '../../components/icons/brands'
import { PriorityFlag, StatusPill } from '../../components/ui/badges'
import { CenteredSpinner, Spinner } from '../../components/ui/Spinner'

export function useCalendarStatus() {
  return useQuery({
    queryKey: ['calendar-status'],
    queryFn: () => api.get<CalendarStatus>('/calendar/status'),
  })
}

export async function startGoogleConnect() {
  try {
    const { url } = await api.get<{ url: string }>('/calendar/google/auth-url')
    window.location.href = url
  } catch (err) {
    toast.error(errorMessage(err))
  }
}

export default function PlannerPage() {
  const status = useCalendarStatus()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()

  // OAuth redirect outcomes
  useEffect(() => {
    if (params.get('connected') === 'google') {
      toast.success('Google Calendar connected')
      void queryClient.invalidateQueries({ queryKey: ['calendar-status'] })
      params.delete('connected')
      setParams(params, { replace: true })
    }
    if (params.get('calendar_error') === '1') {
      toast.error('Google Calendar connection failed — try again')
      params.delete('calendar_error')
      setParams(params, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status.isLoading) return <CenteredSpinner />
  const google = status.data?.google

  return google?.connected ? <ConnectedPlanner accountEmail={google.account_email} /> : <ConnectHero status={status.data} />
}

/* ---------------- Not connected: hero ---------------- */

function ConnectHero({ status }: { status: CalendarStatus | undefined }) {
  const googleConfigured = status?.google.configured ?? false

  return (
    <div className="flex h-full items-center px-[8vw]">
      <div className="max-w-xl">
        <h1 className="text-5xl font-extrabold leading-tight tracking-tight text-fg">
          You, but better
          <br />
          organized
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed text-fg-secondary">
          Connect your calendar to manage events and time block your work around your tasks.
        </p>

        <p className="mt-12 text-sm font-medium text-fg-secondary">Get started with</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            onClick={() => {
              if (googleConfigured) void startGoogleConnect()
              else toast.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env to enable Google Calendar.')
            }}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-850 px-5 py-3 text-sm font-semibold text-fg transition-colors hover:bg-ink-800',
              !googleConfigured && 'opacity-80',
            )}
          >
            <GoogleCalendarIcon size={18} />
            Google Calendar
          </button>
          <button
            onClick={() => toast.info('Microsoft Outlook needs an Azure app registration — not configured yet.')}
            className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-850 px-5 py-3 text-sm font-semibold text-fg opacity-80 transition-colors hover:bg-ink-800"
          >
            <OutlookIcon size={18} />
            Microsoft Outlook
          </button>
        </div>
        {!googleConfigured && (
          <p className="mt-4 text-xs text-fg-muted">
            Google Calendar requires <code className="rounded bg-ink-800 px-1 py-0.5">GOOGLE_CLIENT_ID</code> +{' '}
            <code className="rounded bg-ink-800 px-1 py-0.5">GOOGLE_CLIENT_SECRET</code> in the root .env
            (same OAuth client as Google SSO).
          </p>
        )}
      </div>
    </div>
  )
}

/* ---------------- Connected: events + week tasks ---------------- */

function ConnectedPlanner({ accountEmail }: { accountEmail: string | null }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const events = useQuery({
    queryKey: ['calendar-events'],
    queryFn: () => api.get<CalendarEvent[]>('/calendar/events?days=7'),
    retry: false,
  })

  const weekTasks = useQuery({
    queryKey: ['planner-week-tasks'],
    queryFn: () => api.get<Page<Task>>('/me/tasks?relation=assigned&due=week&page_size=15'),
  })

  const disconnect = async () => {
    try {
      await api.delete('/calendar/google')
      toast.success('Google Calendar disconnected')
      void queryClient.invalidateQueries({ queryKey: ['calendar-status'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  // Group events by day
  const byDay = new Map<string, CalendarEvent[]>()
  for (const event of events.data ?? []) {
    const day = event.start.slice(0, 10)
    const list = byDay.get(day) ?? []
    list.push(event)
    byDay.set(day, list)
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays size={18} className="text-fg-secondary" />
        <h1 className="text-lg font-bold text-fg">Planner</h1>
        <span className="ml-2 flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
          <CheckCircle2 size={12} /> {accountEmail ?? 'Google Calendar'}
        </span>
        <span className="flex-1" />
        <button className="btn-ghost text-xs" onClick={() => void events.refetch()}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn-ghost text-xs hover:!text-red-400" onClick={disconnect}>
          <Unplug size={13} /> Disconnect
        </button>
      </div>

      <div className="mt-6 grid grid-cols-[1.2fr_1fr] gap-6 max-lg:grid-cols-1">
        {/* Upcoming events */}
        <section className="rounded-2xl border border-ink-700 bg-ink-850/40">
          <header className="flex items-center gap-2 border-b border-ink-700/70 px-5 py-3.5">
            <Calendar size={14} className="text-fg-secondary" />
            <h2 className="text-sm font-semibold text-fg">Upcoming events — next 7 days</h2>
          </header>
          <div className="p-3">
            {events.isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : events.isError ? (
              <p className="px-2 py-8 text-center text-sm text-red-400">{errorMessage(events.error)}</p>
            ) : (events.data ?? []).length === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-fg-muted">No events in the next 7 days.</p>
            ) : (
              [...byDay.entries()].map(([day, dayEvents]) => (
                <div key={day} className="mb-3">
                  <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                    {formatDate(day)}
                  </p>
                  {dayEvents.map((event) => (
                    <div key={event.id} className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-ink-800">
                      <span className="w-16 shrink-0 font-mono text-xs text-fg-secondary">
                        {event.all_day
                          ? 'All day'
                          : new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <span className="h-5 w-1 shrink-0 rounded-full bg-brand" />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{event.summary}</span>
                      {event.link && (
                        <a
                          href={event.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-fg-muted opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Tasks due this week (time-block these) */}
        <section className="rounded-2xl border border-ink-700 bg-ink-850/40">
          <header className="flex items-center gap-2 border-b border-ink-700/70 px-5 py-3.5">
            <CheckCircle2 size={14} className="text-fg-secondary" />
            <h2 className="text-sm font-semibold text-fg">Due this week</h2>
          </header>
          <div className="p-3">
            {weekTasks.isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : (weekTasks.data?.items.length ?? 0) === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-fg-muted">Nothing due this week 🎉</p>
            ) : (
              weekTasks.data!.items.map((task) => (
                <button
                  key={task.id}
                  onClick={() => navigate(`/app/tasks/${task.id}`)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-ink-800"
                >
                  <PriorityFlag priority={task.priority} />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{task.title}</span>
                  {task.due_date && <span className="shrink-0 text-xs text-fg-muted">{formatDate(task.due_date)}</span>}
                  <StatusPill status={task.status} />
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
