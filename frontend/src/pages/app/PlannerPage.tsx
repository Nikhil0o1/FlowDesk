import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Unplug,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useProjects } from '../../lib/queries'
import type { CalendarEvent, CalendarStatus, Page, Task } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { GoogleCalendarIcon, OutlookIcon } from '../../components/icons/brands'
import { Modal } from '../../components/ui/Modal'
import { PriorityFlag } from '../../components/ui/badges'
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

/* ---------------- Connected: ClickUp-style week planner ---------------- */

const HOUR_PX = 48

function startOfWeek(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7)) // Monday
  return out
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** Local YYYY-MM-DD (not UTC-shifted). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ConnectedPlanner({ accountEmail }: { accountEmail: string | null }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [slot, setSlot] = useState<{ day: Date; hour: number } | null>(null)

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd = addDays(weekStart, 7)

  const events = useQuery({
    queryKey: ['calendar-events', dayKey(weekStart)],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/calendar/events?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`,
      ),
    retry: false,
  })
  const weekTasks = useQuery({
    queryKey: ['planner-week-tasks'],
    queryFn: () => api.get<Page<Task>>('/me/tasks?relation=assigned&due=week&page_size=50'),
  })
  const overdue = useQuery({
    queryKey: ['planner-overdue-tasks'],
    queryFn: () => api.get<Page<Task>>('/me/tasks?relation=assigned&due=overdue&page_size=20'),
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

  const tasksByDay = new Map<string, Task[]>()
  for (const task of weekTasks.data?.items ?? []) {
    if (!task.due_date) continue
    const list = tasksByDay.get(task.due_date) ?? []
    list.push(task)
    tasksByDay.set(task.due_date, list)
  }

  const monthLabel = weekStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="flex h-full min-h-0">
      {/* ---- Left rail: what needs a slot this week ---- */}
      <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-ink-700 bg-ink-850/40 px-3 py-4">
        <TaskRailSection
          title="Today & overdue"
          tasks={(overdue.data?.items ?? []).concat(
            (weekTasks.data?.items ?? []).filter((t) => t.due_date === dayKey(new Date())),
          )}
          tone="danger"
          empty="Nothing overdue 🎉"
          onOpen={(t) => navigate(`/app/tasks/${t.id}`)}
        />
        <TaskRailSection
          title="Due this week"
          tasks={weekTasks.data?.items ?? []}
          empty="Nothing due this week"
          onOpen={(t) => navigate(`/app/tasks/${t.id}`)}
        />
        <p className="mt-auto px-1 pt-4 text-[11px] leading-relaxed text-fg-muted">
          Click any time slot to block time on your Google Calendar or schedule a task.
        </p>
      </aside>

      {/* ---- Week grid ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-700 px-5 py-3">
          <CalendarDays size={17} className="text-fg-secondary" />
          <h1 className="text-base font-bold text-fg">Planner</h1>
          <span className="ml-1 flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-300">
            <CheckCircle2 size={11} /> {accountEmail ?? 'Google Calendar'}
          </span>
          <span className="flex-1" />
          <button className="btn-secondary !py-1 text-xs" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Today
          </button>
          <button className="btn-ghost !p-1.5" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft size={15} />
          </button>
          <button className="btn-ghost !p-1.5" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight size={15} />
          </button>
          <span className="min-w-32 text-sm font-semibold text-fg">{monthLabel}</span>
          <button className="btn-ghost !p-1.5" title="Refresh" onClick={() => void events.refetch()}>
            <RefreshCw size={13} />
          </button>
          <button className="btn-ghost !p-1.5 hover:!text-red-400" title="Disconnect Google" onClick={disconnect}>
            <Unplug size={13} />
          </button>
        </div>

        {events.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <WeekGrid
            days={days}
            events={events.data ?? []}
            tasksByDay={tasksByDay}
            onSlotClick={(day, hour) => setSlot({ day, hour })}
            onTaskClick={(t) => navigate(`/app/tasks/${t.id}`)}
          />
        )}
      </div>

      {slot && (
        <QuickCreateModal
          slot={slot}
          onClose={() => setSlot(null)}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
            void queryClient.invalidateQueries({ queryKey: ['planner-week-tasks'] })
          }}
        />
      )}
    </div>
  )
}

function TaskRailSection({
  title,
  tasks,
  empty,
  tone,
  onOpen,
}: {
  title: string
  tasks: Task[]
  empty: string
  tone?: 'danger'
  onOpen: (t: Task) => void
}) {
  const unique = [...new Map(tasks.map((t) => [t.id, t])).values()]
  return (
    <section className="mb-5">
      <h3 className={cn('mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider', tone === 'danger' ? 'text-red-400' : 'text-fg-muted')}>
        {title} {unique.length > 0 && <span className="font-normal">({unique.length})</span>}
      </h3>
      {unique.length === 0 ? (
        <p className="px-1 text-xs text-fg-muted">{empty}</p>
      ) : (
        unique.slice(0, 12).map((task) => (
          <button
            key={task.id}
            onClick={() => onOpen(task)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-800"
          >
            <PriorityFlag priority={task.priority} />
            <span className="min-w-0 flex-1 truncate text-xs text-fg">{task.title}</span>
            {task.due_date && (
              <span className={cn('shrink-0 text-[10px]', tone === 'danger' ? 'text-red-400' : 'text-fg-muted')}>
                {formatDate(task.due_date)}
              </span>
            )}
          </button>
        ))
      )}
    </section>
  )
}

function WeekGrid({
  days,
  events,
  tasksByDay,
  onSlotClick,
  onTaskClick,
}: {
  days: Date[]
  events: CalendarEvent[]
  tasksByDay: Map<string, Task[]>
  onSlotClick: (day: Date, hour: number) => void
  onTaskClick: (t: Task) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 8 * HOUR_PX - 8 })
  }, [])

  const todayKey = dayKey(new Date())
  const now = new Date()
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX

  const timedFor = (key: string) =>
    events.filter((e) => !e.all_day && e.start.slice(0, 10) === key)
  const allDayFor = (key: string) => events.filter((e) => e.all_day && e.start.slice(0, 10) === key)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day headers */}
      <div className="grid shrink-0 grid-cols-[56px_repeat(7,1fr)] border-b border-ink-700">
        <div />
        {days.map((d) => {
          const isToday = dayKey(d) === todayKey
          return (
            <div key={d.toISOString()} className="border-l border-ink-700/60 px-2 py-2 text-center">
              <p className="text-[11px] uppercase text-fg-muted">
                {d.toLocaleDateString(undefined, { weekday: 'short' })}
              </p>
              <p
                className={cn(
                  'mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold',
                  isToday ? 'bg-red-500 text-white' : 'text-fg',
                )}
              >
                {d.getDate()}
              </p>
            </div>
          )
        })}
      </div>

      {/* All-day lane: all-day events + tasks due that day */}
      <div className="grid max-h-24 shrink-0 grid-cols-[56px_repeat(7,1fr)] overflow-y-auto border-b border-ink-700 bg-ink-900/60">
        <div className="px-2 py-1.5 text-right text-[10px] text-fg-muted">All day</div>
        {days.map((d) => {
          const key = dayKey(d)
          return (
            <div key={key} className="space-y-0.5 border-l border-ink-700/60 p-1">
              {allDayFor(key).map((e) => (
                <a
                  key={e.id}
                  href={e.link ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate rounded bg-brand-soft px-1.5 py-0.5 text-[10px] text-fg hover:bg-brand/30"
                  title={e.summary}
                >
                  {e.summary}
                </a>
              ))}
              {(tasksByDay.get(key) ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTaskClick(t)}
                  className="block w-full truncate rounded bg-emerald-500/15 px-1.5 py-0.5 text-left text-[10px] text-emerald-300 hover:bg-emerald-500/25"
                  title={`${t.ref} ${t.title}`}
                >
                  ✓ {t.title}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]" style={{ height: 24 * HOUR_PX }}>
          {/* Hour labels */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-fg-muted" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((d) => {
            const key = dayKey(d)
            const isToday = key === todayKey
            return (
              <div key={key} className="group/day relative border-l border-ink-700/60">
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="group/slot absolute left-0 right-0 cursor-pointer border-b border-ink-800/60 transition-colors hover:bg-ink-800/40"
                    style={{ top: h * HOUR_PX, height: HOUR_PX }}
                    onClick={() => onSlotClick(d, h)}
                  >
                    <span className="absolute right-1 top-1 hidden text-fg-muted group-hover/slot:block">
                      <Plus size={11} />
                    </span>
                  </div>
                ))}
                {timedFor(key).map((e) => {
                  const start = new Date(e.start)
                  const end = new Date(e.end)
                  const top = ((start.getHours() * 60 + start.getMinutes()) / 60) * HOUR_PX
                  const height = Math.max(22, ((end.getTime() - start.getTime()) / 3_600_000) * HOUR_PX)
                  return (
                    <a
                      key={e.id}
                      href={e.link ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="absolute left-0.5 right-1 z-10 overflow-hidden rounded-md border-l-2 border-brand bg-brand-soft px-1.5 py-0.5 hover:bg-brand/30"
                      style={{ top, height }}
                      title={e.summary}
                    >
                      <p className="truncate text-[11px] font-medium leading-tight text-fg">{e.summary}</p>
                      <p className="text-[10px] text-fg-secondary">
                        {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </a>
                  )
                })}
                {isToday && (
                  <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top: nowTop }}>
                    <div className="h-px bg-red-500" />
                    <div className="-mt-1 h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Click-a-slot quick create: a Google Calendar event or a FlowDesk task. */
function QuickCreateModal({
  slot,
  onClose,
  onCreated,
}: {
  slot: { day: Date; hour: number }
  onClose: () => void
  onCreated: () => void
}) {
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const [tab, setTab] = useState<'event' | 'task'>('event')
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(60)
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)

  const startAt = new Date(slot.day)
  startAt.setHours(slot.hour, 0, 0, 0)
  const when = `${slot.day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}, ${startAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`

  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      if (tab === 'event') {
        const endAt = new Date(startAt.getTime() + duration * 60_000)
        await api.post('/calendar/events', {
          summary: title.trim(),
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
        })
        toast.success('Event added to your Google Calendar')
      } else {
        const pid = projectId || projects.data?.[0]?.id
        if (!pid) throw new Error('No project available')
        await api.post(`/projects/${pid}/tasks`, { title: title.trim(), due_date: dayKey(slot.day) })
        toast.success('Task scheduled')
      }
      onCreated()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={when} width="max-w-md">
      <div className="space-y-3">
        <div className="flex gap-1">
          {(['event', 'task'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-750',
              )}
            >
              {t === 'event' ? 'Calendar event' : 'Task'}
            </button>
          ))}
        </div>
        <input
          autoFocus
          className="input-dark"
          placeholder={tab === 'event' ? 'Event title (e.g. Focus: PHX-12)' : 'Task name'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim() && void create()}
        />
        {tab === 'event' ? (
          <select className="input-dark" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hours</option>
            <option value={120}>2 hours</option>
          </select>
        ) : (
          <select className="input-dark" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn-primary w-full" disabled={busy || !title.trim()} onClick={() => void create()}>
          <Plus size={14} /> {tab === 'event' ? 'Add to Google Calendar' : `Create task due ${formatDate(dayKey(slot.day))}`}
        </button>
      </div>
    </Modal>
  )
}
