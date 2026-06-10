import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, MoreHorizontal, Plus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { CustomStatus, Task } from '../../lib/types'
import { cn, formatDate, isOverdue } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { AvatarStack } from '../ui/Avatar'
import { Dropdown } from '../ui/Dropdown'
import { LabelChip, PriorityFlag } from '../ui/badges'
import { AssigneePicker, DatePicker, PriorityPicker } from './pickers'

const NEW_GROUP_COLORS = ['#5B9FF0', '#4CB782', '#B07BE0', '#F2994A', '#E667A8', '#26B5CE']

interface KanbanBoardProps {
  projectId: string
  tasks: Task[]
  statuses: CustomStatus[]
  canEdit: boolean
}

export function KanbanBoard({ projectId, tasks, statuses, canEdit }: KanbanBoardProps) {
  const queryClient = useQueryClient()
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<string | null>(null)

  const move = useMutation({
    mutationFn: ({ taskId, statusId }: { taskId: string; statusId: string }) =>
      api.patch(`/tasks/${taskId}`, { status_id: statusId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="flex h-full items-start gap-3 overflow-x-auto px-6 pb-6">
      {statuses.map((status) => {
        const columnTasks = tasks.filter((t) => t.status?.id === status.id)
        return (
          <BoardColumn
            key={status.id}
            projectId={projectId}
            status={status}
            tasks={columnTasks}
            canEdit={canEdit}
            highlight={overStatus === status.id && !!dragTaskId}
            onDragOver={(e) => {
              if (!canEdit) return
              e.preventDefault()
              setOverStatus(status.id)
            }}
            onDragLeave={() => setOverStatus((s) => (s === status.id ? null : s))}
            onDrop={(e) => {
              e.preventDefault()
              setOverStatus(null)
              const taskId = e.dataTransfer.getData('text/task-id') || dragTaskId
              if (taskId) {
                const task = tasks.find((t) => t.id === taskId)
                if (task && task.status?.id !== status.id) move.mutate({ taskId, statusId: status.id })
              }
              setDragTaskId(null)
            }}
            onDragStart={setDragTaskId}
          />
        )
      })}
      {canEdit && <AddGroup projectId={projectId} existingCount={statuses.length} />}
    </div>
  )
}

function BoardColumn({
  projectId,
  status,
  tasks,
  canEdit,
  highlight,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
}: {
  projectId: string
  status: CustomStatus
  tasks: Task[]
  canEdit: boolean
  highlight: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onDragStart: (taskId: string) => void
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(status.name)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['statuses', projectId] })

  const rename = async () => {
    setRenaming(false)
    if (draft.trim() && draft.trim() !== status.name) {
      try {
        await api.patch(`/statuses/${status.id}`, { name: draft.trim() })
        refresh()
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      } catch (err) {
        toast.error(errorMessage(err))
      }
    }
  }

  const remove = async () => {
    try {
      await api.delete(`/statuses/${status.id}`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div
      className={cn(
        'group/col flex max-h-full w-[272px] shrink-0 flex-col rounded-xl border bg-ink-850/60 transition-colors',
        highlight ? 'border-brand' : 'border-transparent',
        tasks.length === 0 && 'bg-ink-850/30',
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void rename()
              if (e.key === 'Escape') {
                setDraft(status.name)
                setRenaming(false)
              }
            }}
            onBlur={() => void rename()}
            className="w-32 rounded border border-brand bg-ink-800 px-1.5 py-0.5 text-xs font-semibold uppercase text-fg outline-none"
          />
        ) : (
          <span
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: status.color, borderColor: `${status.color}55`, backgroundColor: `${status.color}14` }}
          >
            <span className="inline-block h-2 w-2 rounded-full border-2" style={{ borderColor: status.color }} />
            {status.name}
          </span>
        )}
        <span className="text-xs font-semibold" style={{ color: status.color }}>
          {tasks.length}
        </span>
        <span className="flex-1" />
        {canEdit && (
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/col:opacity-100">
            <Dropdown
              align="right"
              width="w-40"
              trigger={
                <button className="rounded-md p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg" title="Group options">
                  <MoreHorizontal size={14} />
                </button>
              }
            >
              {(close) => (
                <>
                  <button
                    className="menu-item"
                    onClick={() => {
                      close()
                      setRenaming(true)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="menu-item text-red-400 hover:text-red-300"
                    onClick={() => {
                      close()
                      void remove()
                    }}
                  >
                    Delete group
                  </button>
                </>
              )}
            </Dropdown>
            <button
              className="rounded-md p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
              title="Add task"
              onClick={() => setAdding(true)}
            >
              <Plus size={14} />
            </button>
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-1">
        {tasks.map((task) => (
          <KanbanCard key={task.id} task={task} draggable={canEdit} onDragStart={() => onDragStart(task.id)} />
        ))}
        {adding && (
          <QuickAdd projectId={projectId} statusId={status.id} onDone={() => setAdding(false)} />
        )}
      </div>

      {canEdit && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="mx-2.5 mb-2.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg-secondary"
        >
          <Plus size={14} /> Add Task
        </button>
      )}
    </div>
  )
}

function KanbanCard({
  task,
  draggable,
  onDragStart,
}: {
  task: Task
  draggable: boolean
  onDragStart: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const overdue = isOverdue(task.due_date, task.completed_at)

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Task>(`/tasks/${task.id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onClick={() => navigate(`/app/tasks/${task.id}`)}
      className="group/card cursor-pointer rounded-xl border border-ink-700 bg-ink-800 p-3 shadow-card transition-colors hover:border-ink-600"
    >
      <p className={cn('text-sm font-medium leading-snug', task.completed_at ? 'text-fg-muted line-through' : 'text-fg')}>
        {task.title}
      </p>

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <LabelChip key={label} label={label} />
          ))}
        </div>
      )}

      {/* Ghost quick actions (assignee / due / priority) */}
      <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {draggable ? (
          <AssigneePicker task={task}>
            {task.assignees.length > 0 ? (
              <span className="cursor-pointer">
                <AvatarStack users={task.assignees} size={20} max={3} />
              </span>
            ) : (
              <GhostButton title="Assign">
                <UserPlus size={12} />
              </GhostButton>
            )}
          </AssigneePicker>
        ) : (
          <AvatarStack users={task.assignees} size={20} max={3} />
        )}

        {draggable ? (
          <DatePicker
            value={task.due_date}
            onChange={(d) => update.mutate(d ? { due_date: d } : { clear_due_date: true })}
          >
            {task.due_date ? (
              <span className={cn('flex cursor-pointer items-center gap-1 text-[11px]', overdue ? 'font-medium text-red-400' : 'text-fg-muted')}>
                <Calendar size={11} />
                {formatDate(task.due_date)}
              </span>
            ) : (
              <GhostButton title="Due date">
                <Calendar size={12} />
              </GhostButton>
            )}
          </DatePicker>
        ) : (
          task.due_date && (
            <span className="flex items-center gap-1 text-[11px] text-fg-muted">
              <Calendar size={11} />
              {formatDate(task.due_date)}
            </span>
          )
        )}

        {draggable ? (
          <PriorityPicker
            value={task.priority}
            onChange={(p) => update.mutate(p ? { priority: p } : { clear_priority: true })}
          >
            {task.priority ? (
              <span className="cursor-pointer">
                <PriorityFlag priority={task.priority} />
              </span>
            ) : (
              <GhostButton title="Priority">
                <PriorityFlag priority={null} />
              </GhostButton>
            )}
          </PriorityPicker>
        ) : (
          <PriorityFlag priority={task.priority} />
        )}

        <span className="flex-1" />
        {task.story_points != null && (
          <span className="rounded bg-ink-750 px-1.5 py-0.5 text-[10px] font-medium text-fg-secondary">
            {task.story_points}
          </span>
        )}
      </div>
    </div>
  )
}

function GhostButton({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <button
      className="flex h-6 w-6 items-center justify-center rounded-md border border-ink-600 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg-secondary"
      title={title}
    >
      {children}
    </button>
  )
}

function QuickAdd({ projectId, statusId, onDone }: { projectId: string; statusId: string; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()

  const create = async () => {
    if (!title.trim()) return
    try {
      await api.post(`/projects/${projectId}/tasks`, { title: title.trim(), status_id: statusId })
      setTitle('')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 p-2">
      <textarea
        autoFocus
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void create()
          }
          if (e.key === 'Escape') onDone()
        }}
        onBlur={() => !title.trim() && onDone()}
        placeholder="Task Name"
        className="w-full resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
      />
    </div>
  )
}

function AddGroup({ projectId, existingCount }: { projectId: string; existingCount: number }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const queryClient = useQueryClient()

  const create = async () => {
    if (!name.trim()) return
    try {
      await api.post(`/projects/${projectId}/statuses`, {
        name: name.trim(),
        color: NEW_GROUP_COLORS[existingCount % NEW_GROUP_COLORS.length],
        category: 'in_progress',
      })
      setName('')
      setAdding(false)
      void queryClient.invalidateQueries({ queryKey: ['statuses', projectId] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="mt-2 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg-secondary"
      >
        <Plus size={14} /> Add group
      </button>
    )
  }
  return (
    <div className="mt-2 w-56 shrink-0 rounded-xl border border-ink-600 bg-ink-850 p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create()
          if (e.key === 'Escape') setAdding(false)
        }}
        onBlur={() => !name.trim() && setAdding(false)}
        placeholder="Group name (status)"
        className="w-full rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-fg outline-none focus:border-brand"
      />
    </div>
  )
}
