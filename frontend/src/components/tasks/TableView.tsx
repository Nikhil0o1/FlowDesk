import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { rememberOpenedTask } from '../../lib/taskListFocus'
import { useRestoreTaskListFocus } from '../../lib/useRestoreTaskListFocus'
import { useTaskPatch, withDueDate, withPriority, withStatus } from '../../lib/taskMutations'
import { buildStatusUpdate } from '../../lib/taskStatusChange'
import type { Task } from '../../lib/types'
import { cn, formatDate, isOverdue } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { AvatarStack } from '../ui/Avatar'
import { PriorityFlag, StatusIcon, StatusPill, TaskTypeBadge } from '../ui/badges'
import { AssigneePicker, DatePicker, PriorityPicker, StatusPicker } from './pickers'
import { NoDueDateDot } from './NoDueDateDot'

const GRID = '44px minmax(260px,1fr) 160px 150px 130px 110px'

interface TableViewProps {
  projectId: string
  tasks: Task[]
  canEdit: boolean
  createGithubIssue?: boolean
}

export function TableView({ projectId, tasks, canEdit, createGithubIssue = false }: TableViewProps) {
  useRestoreTaskListFocus(tasks.length > 0)
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
            <InlineRow projectId={projectId} onDone={() => setAdding(false)} createGithubIssue={createGithubIssue} />
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

  const patch = useTaskPatch()
  const update = (body: Record<string, unknown>, apply?: (t: Task) => Task) =>
    patch.mutate({ taskId: task.id, body, apply })

  const overdue = isOverdue(task.due_date, task.completed_at)
  const statusColor = task.status?.color ?? '#87909E'

  return (
    <div
      data-task-id={task.id}
      className="group grid cursor-pointer items-stretch border-b border-ink-700/60 bg-ink-900 transition-colors last:border-b-0 hover:bg-ink-850"
      style={{ gridTemplateColumns: GRID }}
      onClick={() => {
        rememberOpenedTask(task.id)
        navigate(`/app/tasks/${task.id}`)
      }}
    >
      <Cell center>
        <span className="text-xs text-fg-muted">{index}</span>
      </Cell>
      <Cell>
        {canEdit ? (
          <StatusPicker
            projectId={task.project_id}
            value={task.status}
            variant="icon"
            onChange={(statusId, status) => {
              void buildStatusUpdate(task, status).then((body) => {
                if (body) update(body, withStatus(status))
              })
            }}
          />
        ) : (
          <span className="mr-2 inline-flex shrink-0">
            <StatusIcon category={task.status?.category} color={statusColor} size={15} />
          </span>
        )}
        <span className="mr-1.5 shrink-0">
          <TaskTypeBadge type={task.task_type} />
        </span>
        <span className="truncate align-middle text-sm text-fg">
          {task.title}
        </span>
        {task.subtask_count > 0 && (
          <span className="ml-2 shrink-0 rounded bg-ink-750 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
            {task.subtask_done_count}/{task.subtask_count}
          </span>
        )}
      </Cell>
      <Cell stop>
        {canEdit ? (
          <AssigneePicker task={task} size={22}>
            <span className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-ink-600 text-fg-muted opacity-0 transition-opacity hover:text-fg-secondary group-hover:opacity-100">
              <UserPlus size={12} />
            </span>
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
            onChange={(statusId, status) => {
              void buildStatusUpdate(task, status).then((body) => {
                if (body) update(body, withStatus(status))
              })
            }}
          />
        ) : (
          <StatusPill status={task.status} />
        )}
      </Cell>
      <Cell stop>
        {canEdit ? (
          <DatePicker
            value={task.due_date}
            onChange={(d) => update(d ? { due_date: d } : { clear_due_date: true }, withDueDate(d ?? null))}
          >
            <span className={cn('flex cursor-pointer items-center gap-1.5 text-xs', overdue ? 'font-medium text-red-400' : task.due_date ? 'text-fg-secondary' : '')}>
              {task.due_date ? formatDate(task.due_date) : <NoDueDateDot title={task.title} interactive={false} />}
            </span>
          </DatePicker>
        ) : task.due_date ? (
          <span className="text-xs text-fg-secondary">{formatDate(task.due_date)}</span>
        ) : (
          <NoDueDateDot title={task.title} />
        )}
      </Cell>
      <Cell stop last>
        {canEdit ? (
          <PriorityPicker
            value={task.priority}
            onChange={(p) => update(p ? { priority: p } : { clear_priority: true }, withPriority(p ?? null))}
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

function InlineRow({
  projectId,
  onDone,
  createGithubIssue = false,
}: {
  projectId: string
  onDone: () => void
  createGithubIssue?: boolean
}) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>(`/projects/${projectId}/tasks`, {
        title: title.trim(),
        create_github_issue: createGithubIssue,
      }),
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
