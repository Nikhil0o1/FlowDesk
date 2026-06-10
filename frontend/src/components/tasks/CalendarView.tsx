import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { Task } from '../../lib/types'
import { addDays, cn, startOfWeek, toDateKey } from '../../lib/utils'
import { toast } from '../../stores/toast'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface CalendarViewProps {
  projectId: string
  tasks: Task[]
  canEdit: boolean
}

export function CalendarView({ projectId, tasks, canEdit }: CalendarViewProps) {
  const today = new Date()
  const [monthAnchor, setMonthAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [quickCreateDay, setQuickCreateDay] = useState<string | null>(null)
  const navigate = useNavigate()

  const gridStart = startOfWeek(monthAnchor)
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const todayKey = toDateKey(today)

  const tasksByDay = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.due_date) continue
    const list = tasksByDay.get(task.due_date) ?? []
    list.push(task)
    tasksByDay.set(task.due_date, list)
  }
  const unscheduled = tasks.filter((t) => !t.due_date).length

  const monthLabel = monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      {/* Calendar toolbar */}
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <button
          className="btn-secondary !py-1.5 text-xs"
          onClick={() => setMonthAnchor(new Date(today.getFullYear(), today.getMonth(), 1))}
        >
          Today
        </button>
        <span className="rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-fg-secondary">
          Month
        </span>
        <button
          className="btn-ghost !px-1.5"
          onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="btn-ghost !px-1.5"
          onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}
        >
          <ChevronRight size={15} />
        </button>
        <span className="text-sm font-semibold text-fg">{monthLabel}</span>
        <span className="flex-1" />
        {unscheduled > 0 && (
          <span className="text-xs text-fg-muted">{unscheduled} unscheduled</span>
        )}
      </div>

      {/* Grid */}
      <div className="grid shrink-0 grid-cols-7 border-b border-l border-t border-ink-700">
        {WEEKDAYS.map((day) => (
          <div key={day} className="border-r border-ink-700 bg-ink-850 px-3 py-2 text-xs font-medium text-fg-secondary">
            {day}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 border-l border-ink-700">
        {days.map((day) => {
          const key = toDateKey(day)
          const inMonth = day.getMonth() === monthAnchor.getMonth()
          const isToday = key === todayKey
          const dayTasks = tasksByDay.get(key) ?? []
          return (
            <div
              key={key}
              className={cn(
                'group/day relative flex min-h-[88px] flex-col gap-1 overflow-hidden border-b border-r border-ink-700 p-1.5',
                !inMonth && 'bg-ink-900/60',
                isToday && 'bg-brand-soft/40',
              )}
            >
              <div className="flex items-center justify-between">
                {canEdit ? (
                  <button
                    className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-ink-750 hover:text-fg group-hover/day:opacity-100"
                    title="Add task"
                    onClick={() => setQuickCreateDay(key)}
                  >
                    <Plus size={12} />
                  </button>
                ) : (
                  <span />
                )}
                <span
                  className={cn(
                    'text-xs',
                    isToday
                      ? 'flex h-5 w-5 items-center justify-center rounded-full bg-brand font-bold text-white'
                      : inMonth
                        ? 'text-fg-secondary'
                        : 'text-fg-muted',
                  )}
                >
                  {day.getDate()}
                </span>
              </div>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {dayTasks.slice(0, 4).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => navigate(`/app/tasks/${task.id}`)}
                    className="flex w-full items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800 px-1.5 py-1 text-left transition-colors hover:border-ink-600"
                    title={task.title}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: task.status?.color ?? '#87909E' }}
                    />
                    <span className={cn('truncate text-[11px]', task.completed_at ? 'text-fg-muted line-through' : 'text-fg')}>
                      {task.title}
                    </span>
                  </button>
                ))}
                {dayTasks.length > 4 && (
                  <p className="px-1 text-[10px] text-fg-muted">+{dayTasks.length - 4} more</p>
                )}
              </div>

              {quickCreateDay === key && (
                <QuickCreatePopover
                  projectId={projectId}
                  dateKey={key}
                  onClose={() => setQuickCreateDay(null)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function QuickCreatePopover({
  projectId,
  dateKey,
  onClose,
}: {
  projectId: string
  dateKey: string
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>(`/projects/${projectId}/tasks`, { title: title.trim(), due_date: dateKey }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="absolute left-1 right-1 top-7 z-20 rounded-xl border border-ink-600 bg-ink-850 p-2 shadow-popover">
      <div className="flex items-center gap-1.5">
        <button onClick={onClose} className="shrink-0 text-fg-muted hover:text-fg">
          <X size={12} />
        </button>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) create.mutate()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Task Name"
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <div className="mt-1.5 flex justify-end">
        <button
          onClick={() => title.trim() && create.mutate()}
          disabled={!title.trim() || create.isPending}
          className="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-900 transition-colors hover:bg-gray-200 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  )
}
