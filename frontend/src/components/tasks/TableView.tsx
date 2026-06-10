import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { Task } from '../../lib/types'
import { cn, formatDate, isOverdue } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { AvatarStack } from '../ui/Avatar'
import { PriorityFlag, StatusPill } from '../ui/badges'
import { AssigneePicker, DatePicker, PriorityPicker, StatusPicker } from './pickers'

const GRID = '44px minmax(260px,1fr) 160px 150px 130px 110px'

interface TableViewProps {
  projectId: string
  tasks: Task[]
  canEdit: boolean
}

export function TableView({ projectId, tasks, canEdit }: TableViewProps) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="px-6 pb-20">
      <div className="overflow-hidden rounded-xl border border-ink-700">
        {/* Header */}
        <div
          className="grid items-center border-b border-ink-700 bg-ink-850 text-[11px] font-medium uppercase tracking-wide text-fg-muted"
          style={{ gridTemplateColumns: GRID }}
        >
          <HeaderCell />
          <HeaderCell>Name</HeaderCell>
          <HeaderCell>Assignee</HeaderCell>
          <HeaderCell>Status</HeaderCell>
          <HeaderCell>Due date</HeaderCell>
          <HeaderCell last>Priority</HeaderCell>
        </div>

        {tasks.map((task, index) => (
          <TableRow key={task.id} task={task} index={index + 1} canEdit={canEdit} />
        ))}

        {canEdit &&
          (adding ? (
            <InlineRow projectId={projectId} onDone={() => setAdding(false)} />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-fg-muted transition-colors hover:bg-ink-850 hover:text-fg-secondary"
            >
              <Plus size={14} />
            </button>
          ))}
      </div>
    </div>
  )
}

function HeaderCell({ children, last }: { children?: React.ReactNode; last?: boolean }) {
  return (
    <span className={cn('px-3 py-2', !last && 'border-r border-ink-700/60')}>{children ?? ''}</span>
  )
}

function TableRow({ task, index, canEdit }: { task: Task; index: number; canEdit: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Task>(`/tasks/${task.id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const overdue = isOverdue(task.due_date, task.completed_at)
  const statusColor = task.status?.color ?? '#87909E'

  return (
    <div
      className="group grid cursor-pointer items-stretch border-b border-ink-700/60 bg-ink-900 transition-colors last:border-b-0 hover:bg-ink-850"
      style={{ gridTemplateColumns: GRID }}
      onClick={() => navigate(`/app/tasks/${task.id}`)}
    >
      <Cell center>
        <span className="text-xs text-fg-muted">{index}</span>
      </Cell>
      <Cell>
        <span
          className="mr-2 inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-dashed align-middle"
          style={{ borderColor: statusColor }}
        />
        <span className={cn('truncate align-middle text-sm', task.completed_at ? 'text-fg-muted line-through' : 'text-fg')}>
          {task.title}
        </span>
      </Cell>
      <Cell stop>
        {canEdit ? (
          <AssigneePicker task={task}>
            {task.assignees.length > 0 ? (
              <span className="cursor-pointer">
                <AvatarStack users={task.assignees} size={22} />
              </span>
            ) : (
              <span className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-ink-600 text-fg-muted opacity-0 transition-opacity hover:text-fg-secondary group-hover:opacity-100">
                <UserPlus size={12} />
              </span>
            )}
          </AssigneePicker>
        ) : (
          <AvatarStack users={task.assignees} size={22} />
        )}
      </Cell>
      <Cell stop>
        {canEdit ? (
          <StatusPicker
            projectId={task.project_id}
            value={task.status}
            onChange={(statusId) => update.mutate({ status_id: statusId })}
          >
            <span className="inline-flex cursor-pointer">
              <StatusPill status={task.status} />
            </span>
          </StatusPicker>
        ) : (
          <StatusPill status={task.status} />
        )}
      </Cell>
      <Cell stop>
        {canEdit ? (
          <DatePicker
            value={task.due_date}
            onChange={(d) => update.mutate(d ? { due_date: d } : { clear_due_date: true })}
          >
            <span className={cn('cursor-pointer text-xs', overdue ? 'font-medium text-red-400' : task.due_date ? 'text-fg-secondary' : 'text-fg-muted')}>
              {task.due_date ? formatDate(task.due_date) : '—'}
            </span>
          </DatePicker>
        ) : (
          <span className="text-xs text-fg-secondary">{formatDate(task.due_date)}</span>
        )}
      </Cell>
      <Cell stop last>
        {canEdit ? (
          <PriorityPicker
            value={task.priority}
            onChange={(p) => update.mutate(p ? { priority: p } : { clear_priority: true })}
          >
            <span className={cn('inline-flex cursor-pointer', !task.priority && 'opacity-40 group-hover:opacity-100')}>
              <PriorityFlag priority={task.priority} />
            </span>
          </PriorityPicker>
        ) : (
          <PriorityFlag priority={task.priority} />
        )}
      </Cell>
    </div>
  )
}

function Cell({
  children,
  center,
  stop,
  last,
}: {
  children: React.ReactNode
  center?: boolean
  stop?: boolean
  last?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center px-3 py-2',
        center && 'justify-center',
        !last && 'border-r border-ink-700/60',
      )}
      onClick={stop ? (e) => e.stopPropagation() : undefined}
    >
      {children}
    </div>
  )
}

function InlineRow({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: () => api.post<Task>(`/projects/${projectId}/tasks`, { title: title.trim() }),
    onSuccess: () => {
      setTitle('')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="flex items-center gap-2 bg-ink-850 px-4 py-2">
      <span className="block h-3.5 w-3.5 rounded-full border-2 border-dashed border-ink-600" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim()) create.mutate()
          if (e.key === 'Escape') onDone()
        }}
        placeholder="Task Name"
        className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
      />
      <button onClick={onDone} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-secondary hover:bg-ink-750 hover:text-fg">
        Cancel
      </button>
      <button
        onClick={() => title.trim() && create.mutate()}
        disabled={!title.trim() || create.isPending}
        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition-colors hover:bg-gray-200 disabled:opacity-50"
      >
        Save ↵
      </button>
    </div>
  )
}
