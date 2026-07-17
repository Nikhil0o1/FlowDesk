import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Settings2 } from 'lucide-react'

import { useQuery } from '@tanstack/react-query'

import { InboxToggle } from '../inbox/InboxToggle'
import { Dropdown } from '../ui/Dropdown'
import { api } from '../../lib/api'
import {
  AGENDA_DUE_DEFAULT_HOUR,
  dayKey,
  layoutDueDateTasksOnTimeline,
  PLANNER_HOUR_PX,
  timedTasksForDay,
} from '../../lib/planner'
import { MY_TASKS_MAX_PAGE_SIZE } from '../../lib/myTasksQueries'
import { useCurrentContext, useProjects } from '../../lib/queries'
import { useCalendarStatus, startGoogleConnect } from '../../lib/googleCalendar'
import { rememberOpenedTask } from '../../lib/taskListFocus'
import { useRestoreTaskListFocus } from '../../lib/useRestoreTaskListFocus'
import type { CalendarEvent, Page, Task } from '../../lib/types'
import { cn, isOverdue } from '../../lib/utils'
import { useUIStore } from '../../stores/ui'

type WorkTab = 'todo' | 'done' | 'delegated'

type BucketKey = 'today' | 'overdue' | 'next' | 'unscheduled'

const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'next', label: 'Next' },
  { key: 'unscheduled', label: 'Unscheduled' },
]

function effectiveScheduleDate(task: Task, includeStartDateOnly: boolean): string | null {
  if (task.due_date) return task.due_date
  if (includeStartDateOnly && task.start_date) return task.start_date
  return null
}

function bucketTask(task: Task, today: string, includeStartDateOnly: boolean): BucketKey | null {
  if (task.completed_at) return null
  const schedule = effectiveScheduleDate(task, includeStartDateOnly)
  if (!schedule) return 'unscheduled'
  if (schedule < today) return 'overdue'
  if (schedule === today) return 'today'
  const due = new Date(`${schedule}T12:00:00`)
  const now = new Date(`${today}T12:00:00`)
  const weekEnd = new Date(now)
  weekEnd.setDate(weekEnd.getDate() + 7)
  if (due > now && due <= weekEnd) return 'next'
  return null
}

const MY_WORK_SETTING_ROWS = [
  ['showSubtaskParentNames', 'Subtask parent names'],
  ['showTaskLocations', 'Task locations'],
  ['includeStartDateOnly', 'Include tasks that only have start dates'],
] as const

export function MyWorkSettingsMenu() {
  const settings = useUIStore((s) => s.myWorkCardSettings)
  const setSetting = useUIStore((s) => s.setMyWorkCardSetting)

  return (
    <Dropdown
      align="right"
      width="w-72"
      trigger={
        <button type="button" className="btn-ghost !p-1.5" title="Settings" aria-label="My Work settings">
          <Settings2 size={15} />
        </button>
      }
    >
      {() => (
        <div className="py-1">
          <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Show</p>
          {MY_WORK_SETTING_ROWS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-sm text-fg-secondary">{label}</span>
              <InboxToggle
                accent="amber"
                checked={settings[key]}
                onChange={(value) => setSetting(key, value)}
              />
            </div>
          ))}
        </div>
      )}
    </Dropdown>
  )
}

function MyWorkTaskItem({
  task,
  projectName,
  parentTitle,
  showParent,
  showLocation,
}: {
  task: Task
  projectName?: string
  parentTitle?: string
  showParent: boolean
  showLocation: boolean
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      data-task-id={task.id}
      onClick={() => {
        rememberOpenedTask(task.id)
        navigate(`/app/tasks/${task.id}`)
      }}
      className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-ink-850"
    >
      {showParent && parentTitle && (
        <span className="max-w-full truncate text-[11px] text-fg-muted">{parentTitle}</span>
      )}
      <span className="max-w-full truncate text-sm text-fg">{task.title}</span>
      {showLocation && projectName && (
        <span className="max-w-full truncate text-[11px] text-fg-muted">{projectName}</span>
      )}
    </button>
  )
}

export function MyWorkPanel({
  assignedTasks,
  delegatedTasks,
  doneTasks,
  loading,
  embedded = false,
}: {
  assignedTasks: Task[]
  delegatedTasks: Task[]
  doneTasks: Task[]
  loading: boolean
  embedded?: boolean
}) {
  useRestoreTaskListFocus(!loading)
  const [tab, setTab] = useState<WorkTab>('todo')
  const [openBuckets, setOpenBuckets] = useState<Record<BucketKey, boolean>>({
    today: true,
    overdue: false,
    next: false,
    unscheduled: false,
  })
  const settings = useUIStore((s) => s.myWorkCardSettings)
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const today = dayKey(new Date())

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const project of projects.data ?? []) map.set(project.id, project.name)
    return map
  }, [projects.data])

  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of [...assignedTasks, ...delegatedTasks, ...doneTasks]) {
      map.set(task.id, task.title)
    }
    return map
  }, [assignedTasks, delegatedTasks, doneTasks])

  const tabTasks = useMemo(() => {
    if (tab === 'done') return doneTasks
    if (tab === 'delegated') return delegatedTasks.filter((t) => !t.completed_at)
    return assignedTasks.filter((t) => !t.completed_at && !t.parent_task_id)
  }, [tab, assignedTasks, delegatedTasks, doneTasks])

  const bucketed = useMemo(() => {
    const map: Record<BucketKey, Task[]> = {
      today: [],
      overdue: [],
      next: [],
      unscheduled: [],
    }
    if (tab !== 'todo') {
      return { all: tabTasks, map }
    }
    for (const task of tabTasks) {
      const bucket = bucketTask(task, today, settings.includeStartDateOnly)
      if (bucket) map[bucket].push(task)
    }
    return { all: tabTasks, map }
  }, [tab, tabTasks, today, settings.includeStartDateOnly])

  const toggleBucket = (key: BucketKey) =>
    setOpenBuckets((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        !embedded && 'border-r border-ink-700 bg-ink-900/40',
      )}
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">My Work</h2>
          <MyWorkSettingsMenu />
        </div>
      )}

      <div className="flex gap-5 border-b border-ink-700 px-4">
        {(
          [
            ['todo', 'To Do'],
            ['done', 'Done'],
            ['delegated', 'Delegated'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'border-b-2 py-2.5 text-sm font-medium transition-colors',
              tab === key ? 'border-fg text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {loading ? (
          <p className="px-3 py-6 text-sm text-fg-muted">Loading…</p>
        ) : tab === 'todo' ? (
          BUCKETS.map(({ key, label }) => {
            const tasks = bucketed.map[key]
            const open = openBuckets[key]
            return (
              <div key={key} className="mb-0.5">
                <div className="flex items-center gap-1 px-2">
                  <button
                    type="button"
                    onClick={() => toggleBucket(key)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-2 text-left text-sm hover:bg-ink-850"
                  >
                    {open ? (
                      <ChevronDown size={12} className="shrink-0 text-fg-muted" />
                    ) : (
                      <ChevronRight size={12} className="shrink-0 text-fg-muted" />
                    )}
                    <span className="font-medium text-fg">{label}</span>
                    <span className="tabular-nums text-fg-muted">{tasks.length}</span>
                  </button>
                  {key === 'next' && (
                    <button
                      type="button"
                      className="btn-ghost shrink-0 !p-1 text-fg-muted hover:text-fg"
                      title="Add task"
                      aria-label="Add task to Next"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
                {open && (
                  <div className="pb-2 pl-7 pr-2">
                    {tasks.length === 0 ? (
                      <p className="px-1 py-1.5 text-xs italic text-fg-muted">
                        {key === 'today'
                          ? 'Tasks and reminders assigned to you will show here.'
                          : `No ${label.toLowerCase()} tasks.`}
                      </p>
                    ) : (
                      tasks.map((task) => (
                        <MyWorkTaskItem
                          key={task.id}
                          task={task}
                          showParent={settings.showSubtaskParentNames}
                          showLocation={settings.showTaskLocations}
                          projectName={projectNameById.get(task.project_id)}
                          parentTitle={
                            task.parent_task_id
                              ? taskTitleById.get(task.parent_task_id)
                              : undefined
                          }
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })
        ) : bucketed.all.length === 0 ? (
          <p className="px-3 py-6 text-sm text-fg-muted">
            {tab === 'done' ? 'Completed tasks will appear here.' : 'Tasks you delegated will appear here.'}
          </p>
        ) : (
          <div className="space-y-0.5 px-2">
            {bucketed.all.map((task) => (
              <MyWorkTaskItem
                key={task.id}
                task={task}
                showParent={settings.showSubtaskParentNames}
                showLocation={settings.showTaskLocations}
                projectName={projectNameById.get(task.project_id)}
                parentTitle={
                  task.parent_task_id ? taskTitleById.get(task.parent_task_id) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function MyTasksAgenda({
  day,
  tasks: extraTasks,
  onDayChange,
  embedded = false,
}: {
  day: Date
  /** Optional extra tasks (e.g. already loaded by parent); day-specific fetch always runs. */
  tasks?: Task[]
  onDayChange: (day: Date) => void
  embedded?: boolean
}) {
  const navigate = useNavigate()
  const status = useCalendarStatus()
  const googleConnected = status.data?.google?.connected ?? false
  const googleConfigured = status.data?.google?.configured ?? false
  const key = dayKey(day)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())

  const dueOnDay = useQuery({
    queryKey: ['my-tasks', 'agenda-day', key],
    queryFn: () =>
      api.get<Page<Task>>(
        `/me/tasks?relation=assigned&due_from=${key}&due_to=${key}&page_size=${MY_TASKS_MAX_PAGE_SIZE}`,
      ),
  })

  const scheduledPool = useQuery({
    queryKey: ['my-tasks', 'agenda-scheduled-pool'],
    queryFn: () =>
      api.get<Page<Task>>(`/me/tasks?relation=assigned&page_size=${MY_TASKS_MAX_PAGE_SIZE}`),
    staleTime: 60_000,
  })

  const mergedTasks = useMemo(() => {
    const map = new Map<string, Task>()
    for (const t of [...(extraTasks ?? []), ...(dueOnDay.data?.items ?? []), ...(scheduledPool.data?.items ?? [])]) {
      map.set(t.id, t)
    }
    return [...map.values()]
  }, [extraTasks, dueOnDay.data?.items, scheduledPool.data?.items])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const rangeStart = new Date(day)
  rangeStart.setHours(0, 0, 0, 0)
  const rangeEnd = new Date(day)
  rangeEnd.setHours(23, 59, 59, 999)

  const events = useQuery({
    queryKey: ['calendar-events', key, 'day'],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/calendar/events?start=${rangeStart.toISOString()}&end=${rangeEnd.toISOString()}`,
      ),
    enabled: googleConnected,
    staleTime: 60_000,
    retry: false,
  })

  const timedTasks = timedTasksForDay(mergedTasks, key)
  const dueLayouts = layoutDueDateTasksOnTimeline(mergedTasks, key)
  const dayEvents = (events.data ?? []).filter((e) => !e.all_day && e.start.slice(0, 10) === key)
  const allDayEvents = (events.data ?? []).filter((e) => e.all_day && e.start.slice(0, 10) === key)
  const allDayCount = allDayEvents.length

  const isToday = key === dayKey(new Date())
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * PLANNER_HOUR_PX
  const initialScrollTop = isToday
    ? Math.max(0, nowTop - PLANNER_HOUR_PX * 2)
    : AGENDA_DUE_DEFAULT_HOUR * PLANNER_HOUR_PX - PLANNER_HOUR_PX
  const timelineHeight = 24 * PLANNER_HOUR_PX
  const hourLabel = (h: number) => {
    if (h === 0) return '12 am'
    if (h < 12) return `${h} am`
    if (h === 12) return '12 pm'
    return `${h - 12} pm`
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: initialScrollTop })
  }, [key, initialScrollTop])

  const loadingTasks = dueOnDay.isLoading && !dueOnDay.data

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-900">
      <div className="flex shrink-0 items-center justify-between border-b border-ink-700 bg-ink-850/80 px-4 py-2.5">
        {!embedded && <h2 className="text-sm font-semibold text-fg">Agenda</h2>}
        {embedded && (
          <span className="text-xs font-semibold text-fg-secondary">
            {isToday ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short' })}
          </span>
        )}
        <div className={cn('flex items-center gap-1', embedded && 'ml-auto')}>
          <button
            type="button"
            className="btn-ghost !p-1.5 text-fg-muted hover:text-fg"
            onClick={() => {
              const next = new Date(day)
              next.setDate(next.getDate() - 1)
              onDayChange(next)
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-[7rem] text-center text-xs font-medium text-fg">
            {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          <button
            type="button"
            className="btn-ghost !p-1.5 text-fg-muted hover:text-fg"
            onClick={() => {
              const next = new Date(day)
              next.setDate(next.getDate() + 1)
              onDayChange(next)
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {!googleConnected && googleConfigured && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2">
          <p className="text-[11px] text-fg-secondary">Connect Google Calendar to see meetings here.</p>
          <button type="button" className="btn-secondary !py-1 text-[10px]" onClick={() => void startGoogleConnect()}>
            Connect
          </button>
        </div>
      )}

      {allDayCount > 0 && (
        <div
          className="shrink-0 border-b border-ink-700 bg-ink-850/90 px-3 py-2"
          style={{ minHeight: Math.min(80, 24 + allDayCount * 22) }}
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">All day</p>
          <div className="flex flex-wrap gap-1">
            {allDayEvents.map((event) => (
              <span
                key={event.id}
                className="max-w-full truncate rounded-md border border-brand/30 bg-brand/20 px-2 py-0.5 text-[10px] font-medium text-fg"
                title={event.summary}
              >
                {event.summary}
              </span>
            ))}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto bg-ink-900">
        {loadingTasks ? (
          <p className="px-4 py-8 text-center text-xs text-fg-muted">Loading tasks…</p>
        ) : (
          <div className="relative flex" style={{ height: timelineHeight }}>
            <div className="sticky left-0 z-20 w-[3.25rem] shrink-0 border-r border-ink-700 bg-ink-900">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-fg-muted"
                  style={{ top: h * PLANNER_HOUR_PX }}
                >
                  {hourLabel(h)}
                </div>
              ))}
            </div>

            <div className="relative min-w-0 flex-1">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className={cn(
                    'absolute inset-x-0 border-t border-ink-700',
                    h % 2 === 0 ? 'bg-ink-900' : 'bg-ink-850/40',
                  )}
                  style={{ top: h * PLANNER_HOUR_PX, height: PLANNER_HOUR_PX }}
                />
              ))}

              {dayEvents.map((event) => {
                const start = new Date(event.start)
                const end = new Date(event.end)
                const top = ((start.getHours() * 60 + start.getMinutes()) / 60) * PLANNER_HOUR_PX
                const height = Math.max(24, ((end.getTime() - start.getTime()) / 3_600_000) * PLANNER_HOUR_PX)
                return (
                  <button
                    key={event.id}
                    type="button"
                    className="absolute left-2 right-2 z-[1] overflow-hidden rounded-md border border-brand/40 bg-brand/25 px-2 py-1 text-left text-xs text-fg shadow-sm"
                    style={{ top, height }}
                  >
                    <span className="line-clamp-2 font-medium">{event.summary}</span>
                  </button>
                )
              })}

              {dueLayouts.map(({ task, top, height }) => (
                <button
                  key={`due-${task.id}`}
                  type="button"
                  data-task-id={task.id}
                  onClick={() => {
                    rememberOpenedTask(task.id)
                    navigate(`/app/tasks/${task.id}`)
                  }}
                  className={cn(
                    'absolute left-2 right-2 z-[2] flex flex-col justify-center overflow-hidden rounded-md border px-2 py-1 text-left text-xs text-fg shadow-sm',
                    isOverdue(task.due_date, task.completed_at)
                      ? 'border-red-400/50 bg-red-500/25'
                      : 'border-amber-400/45 bg-amber-500/22',
                  )}
                  style={{ top, height }}
                  title={`Due: ${task.title}`}
                >
                  <span className="truncate font-medium leading-tight">{task.title}</span>
                  <span className="text-[9px] font-medium leading-tight text-fg-muted">Due</span>
                </button>
              ))}

              {timedTasks.map((task) => {
                const start = new Date(task.planned_start_at!)
                const end = new Date(task.planned_end_at!)
                const top = ((start.getHours() * 60 + start.getMinutes()) / 60) * PLANNER_HOUR_PX
                const height = Math.max(24, ((end.getTime() - start.getTime()) / 3_600_000) * PLANNER_HOUR_PX)
                return (
                  <button
                    key={task.id}
                    type="button"
                    data-task-id={task.id}
                    onClick={() => {
                      rememberOpenedTask(task.id)
                      navigate(`/app/tasks/${task.id}`)
                    }}
                    className="absolute left-2 right-2 z-[2] overflow-hidden rounded-md border border-emerald-400/45 bg-emerald-500/22 px-2 py-1 text-left text-xs text-fg shadow-sm"
                    style={{ top, height }}
                  >
                    <span className="line-clamp-2 font-medium">{task.title}</span>
                  </button>
                )
              })}

              {isToday && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10"
                  style={{ top: nowTop }}
                >
                  <div className="h-0.5 bg-orange-400" />
                  <span className="absolute -left-[3.25rem] top-1/2 -translate-y-1/2 rounded bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-white shadow-sm">
                    {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              )}

              {!loadingTasks &&
                dueLayouts.length === 0 &&
                timedTasks.length === 0 &&
                dayEvents.length === 0 &&
                allDayEvents.length === 0 && (
                  <p className="absolute inset-x-0 top-[28%] px-6 text-center text-xs text-fg-muted">
                    No tasks due on this day. Use the arrows to check another date.
                  </p>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
