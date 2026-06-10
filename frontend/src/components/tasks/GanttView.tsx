import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, List, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { Task } from '../../lib/types'
import { addDays, cn, daysBetween, isoWeek, startOfWeek, toDateKey } from '../../lib/utils'
import { toast } from '../../stores/toast'

const DAY_WIDTH = 42
const ROW_HEIGHT = 40
const TOTAL_DAYS = 35 // 5 weeks

interface GanttViewProps {
  projectId: string
  projectName: string
  tasks: Task[]
  canEdit: boolean
}

export function GanttView({ projectId, projectName, tasks, canEdit }: GanttViewProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [scrollKey, setScrollKey] = useState(0) // bump to re-anchor on "Today"

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
    mutationFn: () => api.post<Task>(`/projects/${projectId}/tasks`, { title: title.trim() }),
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
        <span className="rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-fg-secondary">
          Week
        </span>
        <span className="text-xs text-fg-muted">
          Bars need a start &amp; due date — tasks without dates show a dot.
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
            </div>
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => navigate(`/app/tasks/${task.id}`)}
                className="flex w-full items-center gap-2 border-b border-ink-700/60 px-3 pl-9 text-left transition-colors hover:bg-ink-850"
                style={{ height: ROW_HEIGHT }}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full border-2 border-dashed"
                  style={{ borderColor: task.status?.color ?? '#87909E' }}
                />
                <span className={cn('truncate text-sm', task.completed_at ? 'text-fg-muted line-through' : 'text-fg')}>
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
                        isToday &&
                          'flex h-4 w-4 items-center justify-center rounded-full bg-red-500 font-bold text-white',
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
                <GanttRow key={task.id} task={task} rangeStart={rangeStart} onOpen={() => navigate(`/app/tasks/${task.id}`)} />
              ))}
              {canEdit && <div style={{ height: ROW_HEIGHT }} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function GanttRow({ task, rangeStart, onOpen }: { task: Task; rangeStart: Date; onOpen: () => void }) {
  const color = task.status?.color ?? '#8C5BFF'

  let bar: React.ReactNode = null
  const start = task.start_date ? new Date(task.start_date + 'T00:00:00') : null
  const due = task.due_date ? new Date(task.due_date + 'T00:00:00') : null

  if (start && due && due >= start) {
    const left = daysBetween(rangeStart, start) * DAY_WIDTH + 3
    const width = (daysBetween(start, due) + 1) * DAY_WIDTH - 6
    bar = (
      <button
        onClick={onOpen}
        className="absolute top-2 flex h-6 items-center truncate rounded-md px-2 text-left text-[11px] font-medium text-white transition-transform hover:scale-y-105"
        style={{ left, width: Math.max(width, 20), backgroundColor: color }}
        title={task.title}
      >
        <span className="truncate">{task.title}</span>
      </button>
    )
  } else if (due) {
    const left = daysBetween(rangeStart, due) * DAY_WIDTH + DAY_WIDTH / 2 - 5
    bar = (
      <button
        onClick={onOpen}
        className="absolute top-3.5 h-2.5 w-2.5 rotate-45 rounded-[2px] transition-transform hover:scale-125"
        style={{ left, backgroundColor: color }}
        title={`${task.title} — due ${task.due_date}`}
      />
    )
  } else {
    bar = (
      <button
        onClick={onOpen}
        className="absolute left-2 top-4 h-2 w-2 rounded-full bg-amber-400 transition-transform hover:scale-125"
        title={`${task.title} — no dates set`}
      />
    )
  }

  return (
    <div className="relative border-b border-ink-700/40" style={{ height: ROW_HEIGHT }}>
      {bar}
    </div>
  )
}
