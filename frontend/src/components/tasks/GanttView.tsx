import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, List, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { Task } from '../../lib/types'
import { addDays, cn, daysBetween, isoWeek, startOfWeek, toDateKey } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { NoDueDateDot } from './NoDueDateDot'
import { StatusIcon } from '../ui/badges'

const ROW_HEIGHT = 40

type Zoom = 'day' | 'week'
const ZOOM: Record<Zoom, { dayWidth: number; totalDays: number }> = {
  day: { dayWidth: 64, totalDays: 28 },
  week: { dayWidth: 38, totalDays: 56 },
}

interface GanttViewProps {
  projectId: string
  projectName: string
  tasks: Task[]
  canEdit: boolean
  createGithubIssue?: boolean
}

export function GanttView({ projectId, projectName, tasks, canEdit, createGithubIssue = false }: GanttViewProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [zoom, setZoom] = useState<Zoom>('week')
  const [scrollKey, setScrollKey] = useState(0) // bump to re-anchor on "Today"

  const { dayWidth: DAY_WIDTH, totalDays: TOTAL_DAYS } = ZOOM[zoom]

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const rangeStart = addDays(startOfWeek(today), -7)
  const days: Date[] = Array.from({ length: TOTAL_DAYS }, (_, i) => addDays(rangeStart, i))
  const todayIndex = daysBetween(rangeStart, today)

  const weeks: { label: string; start: Date }[] = []
  for (let i = 0; i < TOTAL_DAYS; i += 7) {
    const start = days[i]
    const end = days[i + 6]
    weeks.push({
      label: `W${isoWeek(start)}  ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.getDate()}`,
      start,
    })
  }

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>(`/projects/${projectId}/tasks`, {
        title: title.trim(),
        create_github_issue: createGithubIssue,
      }),
    onSuccess: () => {
      setTitle('')
      setAdding(false)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const timelineWidth = TOTAL_DAYS * DAY_WIDTH

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <button className="btn-secondary !py-1.5 text-xs" onClick={() => setScrollKey((k) => k + 1)}>
          Today
        </button>
        <div className="flex items-center rounded-lg border border-ink-700 bg-ink-800 p-0.5">
          {(['day', 'week'] as Zoom[]).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                zoom === z ? 'bg-ink-700 text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {z}
            </button>
          ))}
        </div>
        <span className="text-xs text-fg-muted">
          Set due dates from the task list or table view.
        </span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-ink-700">
        {/* Left: names */}
        <div className="flex w-72 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
          <div className="flex h-[60px] shrink-0 items-end border-b border-ink-700 bg-ink-850 px-4 pb-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            Name
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-ink-700/60 px-3" style={{ height: ROW_HEIGHT }}>
              <ChevronDown size={13} className="text-fg-muted" />
              <List size={14} className="text-brand" />
              <span className="truncate text-sm font-semibold text-fg">{projectName}</span>
              <span className="ml-auto text-[11px] text-fg-muted">{tasks.length}</span>
            </div>
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => navigate(`/app/tasks/${task.id}`)}
                className="flex w-full items-center gap-2 border-b border-ink-700/60 px-3 pl-9 text-left transition-colors hover:bg-ink-850"
                style={{ height: ROW_HEIGHT }}
              >
                <StatusIcon category={task.status?.category} color={task.status?.color ?? '#87909E'} size={13} />
                {!task.due_date && <NoDueDateDot title={task.title} size="sm" />}
                <span className="truncate text-sm text-fg">
                  {task.title}
                </span>
              </button>
            ))}
            {canEdit &&
              (adding ? (
                <div className="flex items-center gap-2 px-3 pl-9" style={{ height: ROW_HEIGHT }}>
                  <input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && title.trim()) create.mutate()
                      if (e.key === 'Escape') setAdding(false)
                    }}
                    onBlur={() => !title.trim() && setAdding(false)}
                    placeholder="Task Name"
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center gap-2 px-3 pl-9 text-sm text-fg-muted transition-colors hover:bg-ink-850 hover:text-fg-secondary"
                  style={{ height: ROW_HEIGHT }}
                >
                  <Plus size={14} /> Add Task
                </button>
              ))}
          </div>
        </div>

        {/* Right: timeline */}
        <div key={scrollKey} className="min-w-0 flex-1 overflow-x-auto overflow-y-auto">
          <div style={{ width: timelineWidth }}>
            {/* Week header */}
            <div className="flex h-[30px] border-b border-ink-700/60 bg-ink-850">
              {weeks.map((week) => (
                <div
                  key={week.label}
                  className="flex items-center border-r border-ink-700/60 px-2 text-[11px] font-medium text-fg-secondary"
                  style={{ width: DAY_WIDTH * 7 }}
                >
                  {week.label}
                </div>
              ))}
            </div>
            {/* Day header */}
            <div className="flex h-[30px] border-b border-ink-700 bg-ink-850">
              {days.map((day, i) => {
                const isToday = i === todayIndex
                return (
                  <div
                    key={toDateKey(day)}
                    className="flex items-center justify-center gap-1 border-r border-ink-700/40 text-[10px] text-fg-muted"
                    style={{ width: DAY_WIDTH }}
                  >
                    {day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}
                    <span
                      className={cn(
                        isToday && 'flex h-4 w-4 items-center justify-center rounded-full bg-red-500 font-bold text-white',
                      )}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Body */}
            <div className="relative">
              {/* Weekend shading + grid columns */}
              <div className="pointer-events-none absolute inset-0 flex">
                {days.map((day, i) => {
                  const weekend = day.getDay() === 0 || day.getDay() === 6
                  return (
                    <div
                      key={i}
                      className="h-full border-r border-ink-700/30"
                      style={{
                        width: DAY_WIDTH,
                        backgroundImage: weekend
                          ? 'repeating-linear-gradient(45deg, transparent 0 7px, rgba(255,255,255,0.025) 7px 9px)'
                          : undefined,
                      }}
                    />
                  )
                })}
              </div>
              {/* Today line */}
              {todayIndex >= 0 && todayIndex < TOTAL_DAYS && (
                <div
                  className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-red-500"
                  style={{ left: todayIndex * DAY_WIDTH + DAY_WIDTH / 2 }}
                />
              )}

              {/* Project group row */}
              <div className="border-b border-ink-700/60" style={{ height: ROW_HEIGHT }} />

              {/* Task rows */}
              {tasks.map((task) => (
                <GanttRow
                  key={task.id}
                  task={task}
                  rangeStart={rangeStart}
                  dayWidth={DAY_WIDTH}
                  onOpen={() => navigate(`/app/tasks/${task.id}`)}
                />
              ))}
              {canEdit && <div style={{ height: ROW_HEIGHT }} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function GanttRow({
  task,
  rangeStart,
  dayWidth,
  onOpen,
}: {
  task: Task
  rangeStart: Date
  dayWidth: number
  onOpen: () => void
}) {
  const color = task.status?.color ?? '#2B88EE'
  const done = !!task.completed_at
  const progress = task.subtask_count > 0 ? task.subtask_done_count / task.subtask_count : done ? 1 : 0

  let bar: React.ReactNode = null
  const start = task.start_date ? new Date(task.start_date + 'T00:00:00') : null
  const due = task.due_date ? new Date(task.due_date + 'T00:00:00') : null

  if (start && due && due >= start) {
    const left = daysBetween(rangeStart, start) * dayWidth + 3
    const width = (daysBetween(start, due) + 1) * dayWidth - 6
    bar = (
      <button
        onClick={onOpen}
        className={cn(
          'group/bar absolute top-2 flex h-6 items-center overflow-hidden rounded-md text-left text-[11px] font-medium text-white shadow-sm transition-transform hover:scale-y-110',
          done && 'opacity-70',
        )}
        style={{ left, width: Math.max(width, 20), backgroundColor: `${color}66`, border: `1px solid ${color}` }}
        title={task.title}
      >
        {progress > 0 && (
          <span className="absolute inset-y-0 left-0" style={{ width: `${progress * 100}%`, backgroundColor: color }} />
        )}
        <span className="relative z-10 truncate px-2">{task.title}</span>
      </button>
    )
  } else if (due) {
    const left = daysBetween(rangeStart, due) * dayWidth + dayWidth / 2 - 5
    bar = (
      <button
        onClick={onOpen}
        className="absolute top-3.5 h-2.5 w-2.5 rotate-45 rounded-[2px] transition-transform hover:scale-125"
        style={{ left, backgroundColor: color }}
        title={`${task.title} — due ${task.due_date}`}
      />
    )
  } else {
    bar = null
  }

  return (
    <div className="relative border-b border-ink-700/40" style={{ height: ROW_HEIGHT }}>
      {bar}
    </div>
  )
}
