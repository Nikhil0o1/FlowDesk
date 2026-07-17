import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { Task } from '../../lib/types'
import { addDays, cn, startOfWeek, toDateKey } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { PriorityFlag, StatusIcon } from '../ui/badges'
import { AvatarStack } from '../ui/Avatar'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Mode = 'month' | 'week'

interface CalendarViewProps {
  projectId: string
  tasks: Task[]
  canEdit: boolean
  createGithubIssue?: boolean
}

export function CalendarView({ projectId, tasks, canEdit, createGithubIssue = false }: CalendarViewProps) {
  const today = new Date()
  const [mode, setMode] = useState<Mode>('month')
  const [anchor, setAnchor] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()))
  const [quickCreateDay, setQuickCreateDay] = useState<string | null>(null)
  const navigate = useNavigate()

  const todayKey = toDateKey(today)
  const isMonth = mode === 'month'

  const gridStart = isMonth ? startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)) : startOfWeek(anchor)
  const dayCount = isMonth ? 42 : 7
  const days: Date[] = Array.from({ length: dayCount }, (_, i) => addDays(gridStart, i))

  const tasksByDay = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.due_date) continue
    const list = tasksByDay.get(task.due_date) ?? []
    list.push(task)
    tasksByDay.set(task.due_date, list)
  }
  const unscheduled = tasks.filter((t) => !t.due_date).length

  const label = isMonth
    ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : `${gridStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(gridStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  const step = (dir: number) => {
    if (isMonth) setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
    else setAnchor(addDays(anchor, dir * 7))
  }

  const maxChips = isMonth ? 3 : 8

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <button
          className="btn-secondary !py-1.5 text-xs"
          onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}
        >
          Today
        </button>
        <div className="flex items-center rounded-lg border border-ink-700 bg-ink-800 p-0.5">
          {(['month', 'week'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                mode === m ? 'bg-ink-700 text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <button className="btn-ghost !px-1.5" onClick={() => step(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button className="btn-ghost !px-1.5" onClick={() => step(1)}>
          <ChevronRight size={15} />
        </button>
        <span className="text-sm font-semibold text-fg">{label}</span>
        <span className="flex-1" />
        {unscheduled > 0 && <span className="text-xs text-fg-muted">{unscheduled} unscheduled</span>}
      </div>

      {/* Weekday header */}
      <div className="grid shrink-0 grid-cols-7 overflow-hidden rounded-t-lg border border-ink-800 bg-ink-850">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="border-r border-ink-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-7 overflow-hidden rounded-b-lg border-x border-b border-ink-800',
          isMonth ? 'grid-rows-6' : 'grid-rows-1',
        )}
      >
        {days.map((day) => {
          const key = toDateKey(day)
          const inMonth = !isMonth || day.getMonth() === anchor.getMonth()
          const isToday = key === todayKey
          const isPast = key < todayKey
          const dayTasks = tasksByDay.get(key) ?? []
          return (
            <div
              key={key}
              className={cn(
                'group/day relative flex min-h-[96px] flex-col border-b border-r border-ink-800 p-1.5 last:border-r-0',
                !inMonth && 'bg-ink-900/50',
                isToday && 'bg-brand-soft/40',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                {canEdit && !isPast ? (
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
                        ? 'font-medium text-fg-secondary'
                        : 'text-fg-muted',
                  )}
                >
                  {day.getDate()}
                </span>
              </div>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {dayTasks.slice(0, maxChips).map((task) => {
                  const color = task.status?.color ?? '#87909E'
                  return (
                    <button
                      key={task.id}
                      onClick={() => navigate(`/app/tasks/${task.id}`)}
                      className="flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 text-left transition-all hover:brightness-125"
                      style={{ backgroundColor: `${color}24`, boxShadow: `inset 2px 0 0 ${color}` }}
                      title={task.title}
                    >
                      <StatusIcon category={task.status?.category} color={color} size={11} />
                      <span className="flex-1 truncate text-[11px] text-fg">
                        {task.title}
                      </span>
                      {task.priority && <PriorityFlag priority={task.priority} />}
                      {task.assignees.length > 0 && <AvatarStack users={task.assignees} size={16} max={2} />}
                    </button>
                  )
                })}
                {dayTasks.length > maxChips && (
                  <p className="px-1 text-[10px] font-medium text-fg-muted">+{dayTasks.length - maxChips} more</p>
                )}
              </div>

              {quickCreateDay === key && (
                <QuickCreatePopover
                  projectId={projectId}
                  dateKey={key}
                  createGithubIssue={createGithubIssue}
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
  createGithubIssue = false,
  onClose,
}: {
  projectId: string
  dateKey: string
  createGithubIssue?: boolean
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>(`/projects/${projectId}/tasks`, {
        title: title.trim(),
        due_date: dateKey,
        create_github_issue: createGithubIssue,
      }),
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
