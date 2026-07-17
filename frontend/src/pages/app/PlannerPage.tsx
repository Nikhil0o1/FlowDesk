import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  RefreshCw,
  Unplug,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { QuickCreateModal } from '../../components/planner/QuickCreateModal'
import {
  invalidatePlannerTasks,
  usePlannerOverdueTasks,
  usePlannerWeekTasks,
} from '../../components/planner/usePlannerTasks'
import { api, errorMessage } from '../../lib/api'
import { startGoogleConnect, useCalendarStatus } from '../../lib/googleCalendar'
import { EXTERNAL_LINK_REL, safeHttpUrl } from '../../lib/safeUrl'
import { buildPlannerWeekView } from '../../lib/plannerCalendar'
import {
  addDays,
  dayKey,
  PLANNER_HOUR_PX,
  partitionPlannerTasks,
  startOfWeek,
} from '../../lib/planner'
import type { CalendarEvent, CalendarStatus, Task } from '../../lib/types'
import { cn, formatDate } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { GoogleCalendarIcon, OutlookIcon } from '../../components/icons/brands'
import { PriorityFlag } from '../../components/ui/badges'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

const PLANNER_INITIAL_PAST_DAYS = 7
const PLANNER_INITIAL_FUTURE_DAYS = 14
const PLANNER_LOAD_MORE_DAYS = 14
const PLANNER_DAY_WIDTH = 132

export default function PlannerPage() {
  const status = useCalendarStatus()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()

  // OAuth redirect outcomes
  useEffect(() => {
    const connected = params.get('connected')
    const tool = params.get('tool')
    if (connected === 'google' && (!tool || tool === 'calendar')) {
      toast.success('Google Calendar is connected successfully')
      void queryClient.invalidateQueries({ queryKey: ['calendar-status'] })
      void queryClient.invalidateQueries({ queryKey: ['google-status'] })
      params.delete('connected')
      params.delete('tool')
      setParams(params, { replace: true })
    }
    if (params.get('calendar_error') === '1') {
      toast.error('Google Calendar connection failed — try again')
      params.delete('calendar_error')
      setParams(params, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status.isLoading && !status.data) return <CenteredSpinner />
  const google = status.data?.google

  return google?.connected ? <ConnectedPlanner accountEmail={google.account_email} /> : <ConnectHero status={status.data} />
}

/* ---------------- Not connected: hero ---------------- */

const FEATURES = [
  {
    title: 'Calendar sync',
    description:
      'Connect your Google account once. Your calendar events load into the Planner week view alongside your FlowDesk tasks.',
    gradient: 'from-purple-500/20 to-pink-500/20',
  },
  {
    title: 'Tasks beside your week',
    description:
      'See overdue items, today’s work, and tasks due this week in the sidebar while you browse your calendar grid.',
    gradient: 'from-blue-500/20 to-cyan-500/20',
  },
  {
    title: 'Schedule from a time slot',
    description:
      'Click any hour to create a task (with planned start/end), a calendar event, focus time, or out-of-office — tasks can sync to Google Calendar.',
    gradient: 'from-emerald-500/20 to-teal-500/20',
  },
]

function ConnectHero({ status }: { status: CalendarStatus | undefined }) {
  const googleConfigured = status?.google.configured ?? false
  const [activeFeature, setActiveFeature] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % FEATURES.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Background effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-1/4 top-0 h-[500px] w-[500px] rounded-full bg-brand/10 blur-[120px]" />
        <div className="absolute -right-1/4 bottom-0 h-[400px] w-[400px] rounded-full bg-emerald-500/10 blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(var(--fg-muted) 1px, transparent 1px), linear-gradient(90deg, var(--fg-muted) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-8 py-12">
        <div className="flex max-w-6xl flex-col items-center gap-16 lg:flex-row lg:items-start lg:gap-20">
          {/* Left: Hero text */}
          <div className="flex-1 text-center lg:text-left">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-4 py-1.5">
              <CalendarDays size={14} className="text-brand" />
              <span className="text-xs font-medium text-brand">Planner</span>
            </div>
            <h1 className="bg-gradient-to-br from-fg via-fg to-fg-secondary bg-clip-text text-5xl font-extrabold leading-[1.1] tracking-tight text-transparent lg:text-6xl">
              You, but better
              <br />
              <span className="bg-gradient-to-r from-brand to-[#07BEA3] bg-clip-text text-transparent">
                organized
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-fg-secondary lg:mx-0">
              Connect Google Calendar to see your events and scheduled tasks together in one week view.
            </p>

            <div className="mt-10">
              <p className="mb-4 text-sm font-medium text-fg-muted">Get started with</p>
              <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
                {/* ClickUp-style elevated connect cards (same chrome for both providers) */}
                <button
                  type="button"
                  onClick={() => {
                    if (googleConfigured) void startGoogleConnect('calendar')
                    else {
                      toast.error(
                        'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env to enable Google Calendar.',
                      )
                    }
                  }}
                  className="flex items-center gap-3 rounded-xl border border-ink-600/80 bg-ink-850 px-5 py-3.5 text-sm font-semibold text-fg shadow-[0_4px_14px_rgba(0,0,0,0.18)] transition-all hover:-translate-y-0.5 hover:border-ink-500 hover:shadow-[0_8px_20px_rgba(0,0,0,0.22)]"
                >
                  <GoogleCalendarIcon size={22} />
                  Google Calendar
                </button>
                <div
                  className="flex items-center gap-3 rounded-xl border border-ink-600/80 bg-ink-850 px-5 py-3.5 text-sm font-semibold text-fg shadow-[0_4px_14px_rgba(0,0,0,0.18)]"
                  title="Microsoft Outlook is coming soon"
                  aria-disabled
                >
                  <OutlookIcon size={22} />
                  Microsoft Outlook
                  <span className="ml-0.5 rounded-md bg-ink-750 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                    Coming soon
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Feature cards */}
          <div className="w-full max-w-md lg:w-[380px]">
            <div className="space-y-3">
              {FEATURES.map((feature, index) => (
                <button
                  key={feature.title}
                  onClick={() => setActiveFeature(index)}
                  className={cn(
                    'group relative w-full overflow-hidden rounded-2xl border p-5 text-left transition-all duration-300',
                    activeFeature === index
                      ? 'border-brand/40 bg-gradient-to-br ' + feature.gradient + ' shadow-lg shadow-brand/5'
                      : 'border-ink-700 bg-ink-850/50 hover:border-ink-600 hover:bg-ink-850',
                  )}
                >
                  <div className="relative z-10">
                    <h3 className={cn(
                      'text-base font-semibold transition-colors',
                      activeFeature === index ? 'text-fg' : 'text-fg-secondary group-hover:text-fg',
                    )}>
                      {feature.title}
                    </h3>
                    <p className={cn(
                      'mt-1.5 text-sm leading-relaxed transition-all',
                      activeFeature === index
                        ? 'max-h-20 text-fg-secondary opacity-100'
                        : 'max-h-0 overflow-hidden opacity-0',
                    )}>
                      {feature.description}
                    </p>
                  </div>
                  {activeFeature === index && (
                    <div className="absolute bottom-0 left-0 h-1 w-full overflow-hidden rounded-b-2xl bg-ink-700/50">
                      <div className="h-full animate-[progress_4s_linear] bg-gradient-to-r from-brand to-[#07BEA3]" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Progress dots */}
            <div className="mt-6 flex justify-center gap-2">
              {FEATURES.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setActiveFeature(index)}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    activeFeature === index
                      ? 'w-6 bg-brand'
                      : 'w-1.5 bg-ink-600 hover:bg-ink-500',
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Add keyframes for progress animation */}
      <style>{`
        @keyframes progress {
          from { width: 0; }
          to { width: 100%; }
        }
      `}</style>
    </div>
  )
}

/* ---------------- Connected: ClickUp-style week planner ---------------- */

function ConnectedPlanner({ accountEmail }: { accountEmail: string | null }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [rangePadding, setRangePadding] = useState({
    before: PLANNER_INITIAL_PAST_DAYS,
    after: PLANNER_INITIAL_FUTURE_DAYS,
  })
  const [slot, setSlot] = useState<{ day: Date; hour: number } | null>(null)

  useEffect(() => {
    setWeekStart(startOfWeek(new Date()))
    setSelectedEvent(null)
    setSlot(null)
  }, [])

  useEffect(() => {
    setRangePadding({
      before: PLANNER_INITIAL_PAST_DAYS,
      after: PLANNER_INITIAL_FUTURE_DAYS,
    })
  }, [weekStart])

  const rangeStart = addDays(weekStart, -rangePadding.before)
  const rangeDays = rangePadding.before + 7 + rangePadding.after
  const days = Array.from({ length: rangeDays }, (_, i) => addDays(rangeStart, i))
  const weekEnd = addDays(rangeStart, rangeDays)

  const events = useQuery({
    queryKey: ['calendar-events', dayKey(rangeStart), rangeDays],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/calendar/events?start=${rangeStart.toISOString()}&end=${weekEnd.toISOString()}`,
      ),
    staleTime: 60_000,
    retry: 1,
  })
  const weekTasks = usePlannerWeekTasks(rangeStart, rangeDays)
  const overdue = usePlannerOverdueTasks()

  const disconnect = async () => {
    try {
      await api.delete('/calendar/google?tool=calendar')
      toast.success('Google Calendar disconnected')
      void queryClient.invalidateQueries({ queryKey: ['calendar-status'] })
      void queryClient.invalidateQueries({ queryKey: ['google-status'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const weekItems = weekTasks.data?.items ?? []
  const firstWeekStartKey = dayKey(weekStart)
  const firstWeekEndKey = dayKey(addDays(weekStart, 6))
  const firstWeekItems = weekItems.filter(
    (task) => task.due_date && task.due_date >= firstWeekStartKey && task.due_date <= firstWeekEndKey,
  )
  const plannerView = useMemo(
    () => buildPlannerWeekView(weekItems, events.data ?? [], partitionPlannerTasks),
    [weekItems, events.data],
  )
  const [visibleMonthDate, setVisibleMonthDate] = useState(weekStart)

  useEffect(() => {
    setVisibleMonthDate(weekStart)
  }, [weekStart])

  const monthLabel = visibleMonthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

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
          tasks={firstWeekItems}
          empty="Nothing due this week"
          onOpen={(t) => navigate(`/app/tasks/${t.id}`)}
        />
        <p className="mt-auto px-1 pt-4 text-[11px] leading-relaxed text-fg-muted">
          Click any time slot to block time on your Google Calendar or schedule a task.
        </p>
      </aside>

      {/* ---- Week grid ---- */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink-700 px-5 py-3">
          <CalendarDays size={17} className="text-fg-secondary" />
          <h1 className="text-base font-bold text-fg">Planner</h1>
          <span className="ml-1 inline-flex max-w-[280px] items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-0.5 text-[11px]">
            <CheckCircle2 size={12} className="shrink-0 text-emerald-400" aria-hidden />
            <span className="truncate font-medium text-fg" title={accountEmail ?? 'Google Calendar'}>
              {accountEmail ?? 'Google Calendar'}
            </span>
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

        <WeekGrid
          days={days}
          events={plannerView.calendarEvents}
          tasksByDay={plannerView.tasksByDay}
          timedTasks={plannerView.timedTasks}
          loading={events.isFetching}
          focusKey={dayKey(weekStart)}
          focusOffsetDays={rangePadding.before}
          onExtendPast={() =>
            setRangePadding((current) => ({
              ...current,
              before: current.before + PLANNER_LOAD_MORE_DAYS,
            }))
          }
          onExtendFuture={() =>
            setRangePadding((current) => ({
              ...current,
              after: current.after + PLANNER_LOAD_MORE_DAYS,
            }))
          }
          onVisibleDateChange={setVisibleMonthDate}
          onSlotClick={(day, hour) => setSlot({ day, hour })}
          onTaskClick={(t) => navigate(`/app/tasks/${t.id}`)}
          onEventClick={(e) => setSelectedEvent(e)}
        />
      </div>

      {slot && (
        <QuickCreateModal
          slot={slot}
          onClose={() => setSlot(null)}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
            invalidatePlannerTasks(queryClient)
          }}
        />
      )}

      {selectedEvent && (
        <EventPopover event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  )
}

function EventPopover({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const start = new Date(event.start)
  const end = new Date(event.end)
  const when = event.all_day
    ? start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    : `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  return (
    <Modal open onClose={onClose} title="" width="max-w-sm">
      <div className="-mt-2">
        <div className="flex items-start gap-2">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-brand" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold leading-snug text-fg">{event.summary}</h3>
            <p className="mt-0.5 text-sm text-fg-secondary">{when}</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {event.meet_link && (
            <a href={safeHttpUrl(event.meet_link) ?? undefined} target="_blank" rel={EXTERNAL_LINK_REL} className="btn-primary flex w-full items-center justify-center gap-2">
              <Video size={15} /> Join Google Meet
            </a>
          )}
          {event.link && (
            <a href={safeHttpUrl(event.link) ?? undefined} target="_blank" rel={EXTERNAL_LINK_REL} className="btn-secondary flex w-full items-center justify-center gap-2">
              <ExternalLink size={14} /> Open in Google Calendar
            </a>
          )}
        </div>
      </div>
    </Modal>
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

type TimedCalendarBlock =
  | {
      id: string
      kind: 'event'
      event: CalendarEvent
      start: Date
      end: Date
    }
  | {
      id: string
      kind: 'task'
      task: Task
      start: Date
      end: Date
    }

type TimedCalendarLayout = TimedCalendarBlock & {
  top: number
  height: number
  lane: number
  laneCount: number
}

function timedLayoutForDay(key: string, events: CalendarEvent[], tasks: Task[]): TimedCalendarLayout[] {
  const dayHeight = 24 * PLANNER_HOUR_PX
  const blocks: TimedCalendarBlock[] = [
    ...events
      .filter((event) => !event.all_day && event.start.slice(0, 10) === key)
      .map((event) => ({
        id: `event-${event.id}`,
        kind: 'event' as const,
        event,
        start: new Date(event.start),
        end: new Date(event.end),
      })),
    ...tasks
      .filter((task) => task.planned_start_at && dayKey(new Date(task.planned_start_at)) === key)
      .map((task) => ({
        id: `task-${task.id}`,
        kind: 'task' as const,
        task,
        start: new Date(task.planned_start_at!),
        end: new Date(task.planned_end_at!),
      })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime())

  const laneEnds: number[] = []
  const layouts = blocks.map((block) => {
    const startMinutes = block.start.getHours() * 60 + block.start.getMinutes()
    const endMs = Math.max(block.end.getTime(), block.start.getTime() + 15 * 60_000)
    const rawTop = (startMinutes / 60) * PLANNER_HOUR_PX
    const top = Math.min(dayHeight - 24, Math.max(0, rawTop))
    const rawHeight = ((endMs - block.start.getTime()) / 3_600_000) * PLANNER_HOUR_PX
    const height = Math.max(24, Math.min(rawHeight, dayHeight - top))
    const lane = laneEnds.findIndex((end) => block.start.getTime() >= end)
    const safeLane = lane === -1 ? laneEnds.length : lane
    laneEnds[safeLane] = block.start.getTime() + (height / PLANNER_HOUR_PX) * 3_600_000
    return { ...block, top, height, lane: safeLane, laneCount: 1 }
  })

  const laneCount = Math.max(1, laneEnds.length)
  return layouts.map((layout) => ({ ...layout, laneCount }))
}

function WeekGrid({
  days,
  events,
  tasksByDay,
  timedTasks,
  loading,
  focusKey,
  focusOffsetDays,
  onExtendPast,
  onExtendFuture,
  onVisibleDateChange,
  onSlotClick,
  onTaskClick,
  onEventClick,
}: {
  days: Date[]
  events: CalendarEvent[]
  tasksByDay: Map<string, Task[]>
  timedTasks: Task[]
  loading: boolean
  focusKey: string
  focusOffsetDays: number
  onExtendPast: () => void
  onExtendFuture: () => void
  onVisibleDateChange: (day: Date) => void
  onSlotClick: (day: Date, hour: number) => void
  onTaskClick: (t: Task) => void
  onEventClick: (e: CalendarEvent) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const gutterContentRef = useRef<HTMLDivElement>(null)
  const horizontalScrollRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const focusKeyRef = useRef<string | null>(null)
  const focusOffsetRef = useRef(focusOffsetDays)
  useEffect(() => {
    const scrollToCurrentTime = () => {
      const current = new Date()
      const currentTop = ((current.getHours() * 60 + current.getMinutes()) / 60) * PLANNER_HOUR_PX
      const targetTop = Math.max(0, currentTop - PLANNER_HOUR_PX * 1.5)
      scrollRef.current?.scrollTo({ top: targetTop })
      if (gutterContentRef.current) gutterContentRef.current.style.transform = `translateY(-${targetTop}px)`
    }
    scrollToCurrentTime()
    window.setTimeout(scrollToCurrentTime, 0)
  }, [])
  useEffect(() => {
    const el = horizontalScrollRef.current
    if (!el) return
    if (focusKeyRef.current !== focusKey) {
      const todayIndex = days.findIndex((day) => dayKey(day) === dayKey(new Date()))
      const targetIndex = todayIndex === -1 ? focusOffsetDays : Math.max(0, todayIndex - 1)
      el.scrollLeft = targetIndex * PLANNER_DAY_WIDTH
      focusKeyRef.current = focusKey
      focusOffsetRef.current = targetIndex
      onVisibleDateChange(days[Math.min(days.length - 1, Math.max(0, targetIndex))])
      return
    }

    const delta = focusOffsetDays - focusOffsetRef.current
    if (delta !== 0) {
      el.scrollLeft += delta * PLANNER_DAY_WIDTH
      focusOffsetRef.current = focusOffsetDays
    }
  }, [focusKey, focusOffsetDays])

  const todayKey = dayKey(new Date())
  const now = new Date()
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * PLANNER_HOUR_PX
  const gridTemplateColumns = `repeat(${days.length}, ${PLANNER_DAY_WIDTH}px)`
  const calendarWidth = days.length * PLANNER_DAY_WIDTH
  const plannerLine = 'var(--ink-700)'
  const plannerStrongLine = 'var(--ink-700)'

  const allDayFor = (key: string) => events.filter((e) => e.all_day && e.start.slice(0, 10) === key)
  const handleHorizontalScroll = () => {
    const el = horizontalScrollRef.current
    if (!el || loadingMoreRef.current) return
    const visibleIndex = Math.max(0, Math.min(days.length - 1, Math.floor((el.scrollLeft + el.clientWidth / 2) / PLANNER_DAY_WIDTH)))
    onVisibleDateChange(days[visibleIndex])
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth
    if (el.scrollLeft < PLANNER_DAY_WIDTH * 2) {
      loadingMoreRef.current = true
      onExtendPast()
      window.setTimeout(() => {
        loadingMoreRef.current = false
      }, 250)
    } else if (remaining < PLANNER_DAY_WIDTH * 2) {
      loadingMoreRef.current = true
      onExtendFuture()
      window.setTimeout(() => {
        loadingMoreRef.current = false
      }, 250)
    }
  }
  const handleVerticalScroll = () => {
    if (!scrollRef.current || !gutterContentRef.current) return
    gutterContentRef.current.style.transform = `translateY(-${scrollRef.current.scrollTop}px)`
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {loading && <div className="absolute inset-x-0 top-0 z-30 h-0.5 animate-pulse bg-brand/70" />}
      <div ref={horizontalScrollRef} onScroll={handleHorizontalScroll} className="ml-[60px] min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full min-h-0 flex-col" style={{ width: calendarWidth }}>
          {/* Day headers */}
          <div className="grid h-16 shrink-0 border-b border-ink-700" style={{ gridTemplateColumns, borderColor: plannerStrongLine }}>
            {days.map((d) => {
              const isToday = dayKey(d) === todayKey
              return (
                <div key={d.toISOString()} className="border-l px-2 py-2 text-center" style={{ borderColor: plannerLine }}>
                  <p className="text-[11px] uppercase text-fg-muted">
                    {d.toLocaleDateString(undefined, { weekday: 'short' })}
                  </p>
                  <div
                    className={cn(
                      'mx-auto mt-1 inline-flex min-w-14 items-center justify-center rounded-full border px-2 py-0.5 text-xs font-semibold leading-none',
                      isToday
                        ? 'border-orange-400/50 bg-orange-500/15 text-orange-700 shadow-[0_0_0_1px_rgba(251,146,60,0.08)] dark:text-orange-300'
                        : 'border-transparent text-fg',
                    )}
                  >
                    {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* All-day lane: all-day events + tasks due that day */}
          <div
            className="grid h-8 shrink-0 overflow-y-auto border-b bg-ink-900/60"
            style={{ gridTemplateColumns, borderColor: plannerStrongLine }}
          >
            {days.map((d) => {
              const key = dayKey(d)
              return (
                <div key={key} className="space-y-0.5 border-l p-1" style={{ borderColor: plannerLine }}>
                  {allDayFor(key).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onEventClick(e)}
                      className="block w-full truncate rounded bg-brand-soft px-1.5 py-0.5 text-left text-[10px] text-fg hover:bg-brand/30"
                      title={e.summary}
                    >
                      {e.summary}
                    </button>
                  ))}
                  {(tasksByDay.get(key) ?? []).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onTaskClick(t)}
                      className="block w-full truncate rounded bg-emerald-500/15 px-1.5 py-0.5 text-left text-[10px] text-emerald-300 hover:bg-emerald-500/25"
                      title={`${t.ref} ${t.title}`}
                    >
                      Task: {t.title}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>

          {/* Time grid */}
          <div ref={scrollRef} onScroll={handleVerticalScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="relative grid" style={{ height: 24 * PLANNER_HOUR_PX, gridTemplateColumns }}>
              {/* Day columns */}
              {days.map((d) => {
                const key = dayKey(d)
                const isToday = key === todayKey
                const timedLayouts = timedLayoutForDay(key, events, timedTasks)
                return (
                  <div
                    key={key}
                    className={cn('relative overflow-hidden border-l', isToday && 'bg-brand/[0.05]')}
                    style={{ borderColor: plannerLine }}
                  >
                    {/* Hour lines + click targets */}
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className="group/slot absolute inset-x-0 cursor-pointer border-t transition-colors hover:bg-ink-700/10"
                        style={{ top: h * PLANNER_HOUR_PX, height: PLANNER_HOUR_PX, borderColor: plannerLine }}
                        onClick={() => onSlotClick(d, h)}
                      >
                        <span className="pointer-events-none absolute right-1.5 top-1 hidden items-center gap-0.5 rounded bg-ink-750 px-1 py-0.5 text-[9px] text-fg-secondary group-hover/slot:flex">
                          <Plus size={9} /> Add
                        </span>
                      </div>
                    ))}

                    {timedLayouts.map((layout) => {
                      const timeLabel = layout.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                      const showTime = layout.height >= 54
                      const left = `calc(${(layout.lane / layout.laneCount) * 100}% + 4px)`
                      const width = `calc(${100 / layout.laneCount}% - 6px)`
                      const style = { top: layout.top, height: layout.height, left, width }

                      if (layout.kind === 'event') {
                        const event = layout.event
                        return (
                          <button
                            key={layout.id}
                            onClick={() => onEventClick(event)}
                            className="group/ev absolute z-10 flex flex-col overflow-hidden rounded-md border border-brand/40 border-l-[3px] border-l-brand bg-brand/15 px-2 py-1 text-left shadow-sm transition-colors hover:bg-brand/25"
                            style={style}
                            title={`${event.summary} - ${timeLabel}`}
                          >
                            <p className="line-clamp-2 break-words text-[11px] font-semibold leading-tight text-fg">{event.summary}</p>
                            {showTime && <p className="mt-0.5 truncate text-[10px] leading-tight text-fg-secondary">{timeLabel}</p>}
                            {event.meet_link && (
                              <Video size={11} className="absolute bottom-1 right-1 text-brand opacity-80" />
                            )}
                          </button>
                        )
                      }

                      const task = layout.task
                      const label = task.ref ? `${task.ref}: ${task.title}` : task.title
                      return (
                        <button
                          key={layout.id}
                          onClick={() => onTaskClick(task)}
                          className="absolute z-10 flex flex-col overflow-hidden rounded-md border border-emerald-500/40 border-l-[3px] border-l-emerald-500 bg-emerald-500/15 px-2 py-1 text-left shadow-sm transition-colors hover:bg-emerald-500/25"
                          style={style}
                          title={`${task.ref} ${task.title}`}
                        >
                          <p className="line-clamp-2 break-words text-[11px] font-semibold leading-tight text-emerald-100">{label}</p>
                          {showTime && <p className="mt-0.5 truncate text-[10px] leading-tight text-emerald-300/80">{timeLabel}</p>}
                        </button>
                      )
                    })}

                    {isToday && (
                      <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }}>
                        <div className="h-px bg-orange-400" />
                        <div className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-orange-400" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-30 flex w-[60px] flex-col bg-ink-900/95">
        <div className="h-16 shrink-0 border-b border-r" style={{ borderColor: plannerStrongLine }} />
        <div
          className="h-8 shrink-0 border-b border-r px-2 py-1.5 text-right text-[10px] text-fg-muted"
          style={{ borderColor: plannerStrongLine }}
        >
          All day
        </div>
        <div className="min-h-0 flex-1 overflow-hidden border-r" style={{ borderColor: plannerStrongLine }}>
          <div ref={gutterContentRef} className="relative will-change-transform" style={{ height: 24 * PLANNER_HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-2.5 -translate-y-1/2 text-[10px] font-medium tabular-nums text-fg-secondary"
                style={{ top: h * PLANNER_HOUR_PX }}
              >
                {h === 0 ? '' : `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
