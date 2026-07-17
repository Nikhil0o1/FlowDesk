import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerUpLeft,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Share2,
  Square,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { openAppPath } from '../../lib/safeUrl'
import { invalidateKanbanTaskQueries } from '../../lib/kanbanCache'
import { rememberOpenedTask } from '../../lib/taskListFocus'
import { useRestoreTaskListFocus } from '../../lib/useRestoreTaskListFocus'
import {
  cancelTaskCaches,
  invalidateTaskCaches,
  patchTaskInCaches,
  removeTaskFromCaches,
  restoreTaskCaches,
  snapshotTaskCaches,
} from '../../lib/taskCache'
import { useTaskPatch, withDueDate, withPriority, withStatus } from '../../lib/taskMutations'
import { buildStatusUpdate } from '../../lib/taskStatusChange'
import type { CustomStatus, Task, TimeEntry } from '../../lib/types'
import { cn, formatDate, isOverdue } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { AvatarStack } from '../ui/Avatar'
import { SubtaskIcon } from '../icons/subtask'
import { Dropdown } from '../ui/Dropdown'
import { LabelChip, PriorityFlag, StatusIcon } from '../ui/badges'
import { AssigneePicker, DatePicker, PriorityPicker } from './pickers'
import { NoDueDateDot } from './NoDueDateDot'
import { ShareModal } from './ShareModal'

const NEW_GROUP_COLORS = ['#5B9FF0', '#4CB782', '#B07BE0', '#F2994A', '#E667A8', '#26B5CE']

function kanbanAddTaskHoverBg(status: CustomStatus): string {
  const name = status.name.toLowerCase().trim()

  switch (status.category) {
    case 'todo':
      return 'var(--kanban-add-hover-todo)'
    case 'done':
      return 'var(--kanban-add-hover-done)'
    case 'cancelled':
      return 'var(--kanban-add-hover-cancelled)'
    case 'in_progress':
      if (name.includes('review')) return 'var(--kanban-add-hover-review)'
      if (name.includes('progress')) return 'var(--kanban-add-hover-progress)'
      return `${status.color}22`
    default:
      return `${status.color}22`
  }
}

/** ClickUp-style tinted column backgrounds per status group. */
function kanbanColumnStyle(status: CustomStatus): React.CSSProperties {
  const name = status.name.toLowerCase().trim()

  let backgroundColor: string
  switch (status.category) {
    case 'todo':
      backgroundColor = 'var(--kanban-col-todo)'
      break
    case 'done':
      backgroundColor = 'var(--kanban-col-done)'
      break
    case 'cancelled':
      backgroundColor = 'var(--kanban-col-cancelled)'
      break
    case 'in_progress':
      if (name.includes('review')) backgroundColor = 'var(--kanban-col-review)'
      else if (name.includes('progress')) backgroundColor = 'var(--kanban-col-progress)'
      else backgroundColor = `${status.color}18`
      break
    default:
      backgroundColor = `${status.color}18`
  }

  return {
    backgroundColor,
    '--kanban-accent': status.color,
    '--kanban-add-hover': kanbanAddTaskHoverBg(status),
  } as React.CSSProperties
}

interface KanbanBoardProps {
  projectId: string
  tasks: Task[]
  statuses: CustomStatus[]
  canEdit: boolean
  canEditTask?: (task: Task) => boolean
  /** When set, inline "Add Task" also links new cards into this sprint. */
  sprintId?: string
  /** React-query key for this task list (Task[]). Enables optimistic drag + targeted invalidation. */
  taskListQueryKey?: readonly unknown[]
  createGithubIssue?: boolean
}

export function KanbanBoard({
  projectId,
  tasks,
  statuses,
  canEdit,
  canEditTask,
  sprintId,
  taskListQueryKey,
  createGithubIssue = false,
}: KanbanBoardProps) {
  useRestoreTaskListFocus(tasks.length > 0)
  const queryClient = useQueryClient()
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<string | null>(null)
  const taskCanEdit = (task: Task) => canEdit && (canEditTask ? canEditTask(task) : true)

  // Optimistic drag — the card jumps to the new column instantly (across every
  // cached list shape: project board Page<Task> and sprint board Task[]), then
  // reconciles in the background.
  const move = useMutation({
    mutationFn: ({ taskId, statusId }: { taskId: string; statusId: string }) =>
      api.patch(`/tasks/${taskId}`, { status_id: statusId }),
    onMutate: async ({ taskId, statusId }) => {
      const status = statuses.find((s) => s.id === statusId) ?? null
      await cancelTaskCaches(queryClient)
      const snapshot = snapshotTaskCaches(queryClient)
      patchTaskInCaches(queryClient, taskId, withStatus(status))
      return { snapshot }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.snapshot) restoreTaskCaches(queryClient, ctx.snapshot)
      toast.error(errorMessage(err))
    },
    onSettled: () => {
      invalidateTaskCaches(queryClient)
      invalidateKanbanTaskQueries(queryClient, taskListQueryKey)
    },
  })

  return (
    <div className="flex h-full items-start gap-3 overflow-x-auto px-6 pb-6">
      {statuses.map((status) => {
        const columnTasks = tasks.filter((t) => t.status?.id === status.id)
        return (
          <BoardColumn
            key={status.id}
            projectId={projectId}
            sprintId={sprintId}
            status={status}
            tasks={columnTasks}
            allTasks={tasks}
            statuses={statuses}
            canEdit={canEdit}
            canEditTask={taskCanEdit}
            taskListQueryKey={taskListQueryKey}
            highlight={overStatus === status.id && !!dragTaskId}
            onDragOver={(e) => {
              if (!canEdit) return
              const task = dragTaskId ? tasks.find((t) => t.id === dragTaskId) : null
              if (task && !taskCanEdit(task)) return
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
                if (task && task.status?.id !== status.id && taskCanEdit(task)) {
                  move.mutate({ taskId, statusId: status.id })
                }
              }
              setDragTaskId(null)
            }}
            onDragStart={setDragTaskId}
            createGithubIssue={createGithubIssue}
          />
        )
      })}
      {canEdit && <AddGroup projectId={projectId} existingCount={statuses.length} />}
    </div>
  )
}

function BoardColumn({
  projectId,
  sprintId,
  status,
  tasks,
  allTasks,
  statuses,
  canEdit,
  canEditTask,
  taskListQueryKey,
  highlight,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  createGithubIssue = false,
}: {
  projectId: string
  sprintId?: string
  status: CustomStatus
  tasks: Task[]
  allTasks: Task[]
  statuses: CustomStatus[]
  canEdit: boolean
  canEditTask: (task: Task) => boolean
  taskListQueryKey?: readonly unknown[]
  highlight: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onDragStart: (taskId: string) => void
  createGithubIssue?: boolean
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
        invalidateKanbanTaskQueries(queryClient, taskListQueryKey)
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
        'group/col flex max-h-full w-[272px] shrink-0 flex-col rounded-xl border transition-colors',
        highlight ? 'border-brand' : 'border-transparent',
      )}
      style={kanbanColumnStyle(status)}
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
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: status.color }}
          >
            <StatusIcon category={status.category} color="#FFFFFF" size={13} />
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
          <KanbanCard
            key={task.id}
            task={task}
            projectId={projectId}
            statuses={statuses}
            allTasks={allTasks}
            canEdit={canEditTask(task)}
            taskListQueryKey={taskListQueryKey}
            createGithubIssue={createGithubIssue}
            onDragStart={() => onDragStart(task.id)}
          />
        ))}
        {adding && (
          <QuickAdd
            projectId={projectId}
            sprintId={sprintId}
            statusId={status.id}
            taskListQueryKey={taskListQueryKey}
            createGithubIssue={createGithubIssue}
            onDone={() => setAdding(false)}
          />
        )}
      </div>

      {canEdit && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="kanban-add-task mx-2.5 mb-2.5 flex w-[calc(100%-1.25rem)] items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Add Task
        </button>
      )}
    </div>
  )
}

type MenuMode = 'root' | 'move' | 'subtask'

function KanbanCard({
  task,
  projectId,
  statuses,
  allTasks,
  canEdit,
  taskListQueryKey,
  createGithubIssue = false,
  onDragStart,
}: {
  task: Task
  projectId: string
  statuses: CustomStatus[]
  allTasks: Task[]
  canEdit: boolean
  taskListQueryKey?: readonly unknown[]
  createGithubIssue?: boolean
  onDragStart: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const overdue = isOverdue(task.due_date, task.completed_at)

  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [addingSub, setAddingSub] = useState(false)
  const [menuMode, setMenuMode] = useState<MenuMode>('root')
  const [shareOpen, setShareOpen] = useState(false)

  const isDone = !!task.completed_at || task.status?.category === 'done'
  const doneStatus = statuses.find((s) => s.category === 'done')
  const todoStatus = statuses.find((s) => s.category === 'todo') ?? statuses[0]

  // Shared across every card (single request, deduped by React Query) so each
  // card knows whether ITS task is the one currently being timed.
  const runningTimer = useQuery({
    queryKey: ['timer', 'current'],
    queryFn: () => api.get<TimeEntry | null>('/timer/current'),
    enabled: canEdit,
  })
  const timerOnThisTask = runningTimer.data?.task_id === task.id && !runningTimer.data?.ended_at

  const invalidate = () => invalidateKanbanTaskQueries(queryClient, taskListQueryKey)

  // Optimistic field edits — the card reflects the change instantly.
  const patch = useTaskPatch()
  const update = (body: Record<string, unknown>, apply?: (t: Task) => Task) =>
    patch.mutate({ taskId: task.id, body, apply })

  const saveTitle = () => {
    setRenaming(false)
    const next = titleDraft.trim()
    if (next && next !== task.title) update({ title: next }, (t) => ({ ...t, title: next }))
    else setTitleDraft(task.title)
  }

  const toggleComplete = () => {
    if (isDone) {
      if (todoStatus) update({ status_id: todoStatus.id }, withStatus(todoStatus))
    } else if (doneStatus) {
      void buildStatusUpdate(task, doneStatus).then((body) => {
        if (body) update(body, withStatus(doneStatus))
      })
    } else {
      toast.error('No "Complete" status in this project')
    }
  }

  const duplicate = async () => {
    try {
      const copy = await api.post<Task>(`/tasks/${task.id}/duplicate`)
      toast.success(`${copy.ref} created`)
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/app/tasks/${task.id}`)
    toast.success('Link copied')
  }

  const archive = async () => {
    try {
      await api.patch(`/tasks/${task.id}`, { is_archived: true })
      toast.success('Archived')
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const remove = async () => {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return
    // Optimistic: the card disappears immediately; rolled back on failure.
    const snapshot = snapshotTaskCaches(queryClient)
    removeTaskFromCaches(queryClient, task.id)
    try {
      await api.delete(`/tasks/${task.id}`)
      toast.success('Task deleted')
      invalidate()
    } catch (err) {
      restoreTaskCaches(queryClient, snapshot)
      toast.error(errorMessage(err))
    }
  }

  const toggleTimer = async () => {
    try {
      if (timerOnThisTask) {
        await api.post('/timer/stop')
        toast.success('Timer stopped')
      } else {
        await api.post(`/tasks/${task.id}/timer/start`, {})
        toast.success('Timer started')
      }
      void queryClient.invalidateQueries({ queryKey: ['timer', 'current'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const setParent = async (parentId: string | null) => {
    try {
      await api.patch(`/tasks/${task.id}`, parentId ? { parent_task_id: parentId } : { clear_parent: true })
      toast.success(parentId ? 'Converted to subtask' : 'Promoted to task')
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  // Candidate parents: other top-level tasks in this project (backend rejects
  // nesting under a task that is itself a subtask).
  const parentCandidates = allTasks.filter((t) => t.id !== task.id && !t.parent_task_id)

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      data-task-id={task.id}
      draggable={canEdit && !renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onClick={() => {
        rememberOpenedTask(task.id)
        navigate(`/app/tasks/${task.id}`)
      }}
      className="group/card relative cursor-pointer rounded-xl border border-ink-700 bg-ink-800 p-3 shadow-card transition-colors hover:border-ink-600"
    >
      {/* Hover toolbar */}
      {canEdit && !renaming && (
        <div
          className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 p-0.5 opacity-0 shadow-lg transition-opacity group-hover/card:opacity-100"
          onClick={stop}
        >
          <CardIconButton title={isDone ? 'Mark as not complete' : 'Mark complete'} onClick={toggleComplete}>
            <CheckCircle2 size={14} className={isDone ? 'text-emerald-400' : ''} />
          </CardIconButton>
          <CardIconButton title="Add subtask" onClick={() => setAddingSub(true)}>
            <PlusCircleIcon />
          </CardIconButton>
          <CardIconButton
            title="Rename"
            onClick={() => {
              setTitleDraft(task.title)
              setRenaming(true)
            }}
          >
            <Pencil size={13} />
          </CardIconButton>
          <Dropdown
            align="right"
            width="w-56"
            trigger={
              <button
                className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
                title="More actions"
                onClick={() => setMenuMode('root')}
              >
                <MoreHorizontal size={14} />
              </button>
            }
          >
            {(close) => {
              if (menuMode === 'move') {
                return (
                  <>
                    <DrillHeader label="Move to status" onBack={() => setMenuMode('root')} />
                    {statuses.map((s) => (
                      <button
                        key={s.id}
                        className="menu-item"
                        onClick={() => {
                          if (s.id !== task.status?.id) {
                            void buildStatusUpdate(task, s).then((body) => {
                              if (body) update(body, withStatus(s))
                            })
                          }
                          setMenuMode('root')
                          close()
                        }}
                      >
                        <StatusIcon category={s.category} color={s.color} size={14} />
                        <span className="flex-1 truncate">{s.name}</span>
                        {s.id === task.status?.id && <Check size={14} className="text-brand" />}
                      </button>
                    ))}
                  </>
                )
              }
              if (menuMode === 'subtask') {
                return (
                  <>
                    <DrillHeader label="Nest under task" onBack={() => setMenuMode('root')} />
                    {parentCandidates.length === 0 && (
                      <p className="px-3 py-2 text-xs text-fg-muted">No eligible parent tasks</p>
                    )}
                    {parentCandidates.map((p) => (
                      <button
                        key={p.id}
                        className="menu-item"
                        onClick={() => {
                          void setParent(p.id)
                          setMenuMode('root')
                          close()
                        }}
                      >
                        <span className="truncate text-[10px] text-fg-muted">{p.ref}</span>
                        <span className="flex-1 truncate">{p.title}</span>
                      </button>
                    ))}
                  </>
                )
              }
              return (
                <>
                  <button
                    className="menu-item"
                    onClick={() => {
                      openAppPath(`/app/tasks/${task.id}`)
                      close()
                    }}
                  >
                    <ExternalLink size={14} /> <span className="flex-1">Open in new tab</span>
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      void copyLink()
                      close()
                    }}
                  >
                    <Link2 size={14} /> <span className="flex-1">Copy link</span>
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      void duplicate()
                      close()
                    }}
                  >
                    <Copy size={14} /> <span className="flex-1">Duplicate</span>
                  </button>
                  <div className="my-1 border-t border-ink-700" />
                  <button className="menu-item" onClick={() => setMenuMode('move')}>
                    <ArrowRight size={14} /> <span className="flex-1">Move to status</span>
                    <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {task.parent_task_id ? (
                    <button
                      className="menu-item"
                      onClick={() => {
                        void setParent(null)
                        close()
                      }}
                    >
                      <CornerUpLeft size={14} /> <span className="flex-1">Convert to task</span>
                    </button>
                  ) : (
                    <button className="menu-item" onClick={() => setMenuMode('subtask')}>
                      <SubtaskIcon size={14} /> <span className="flex-1">Convert to subtask</span>
                      <ChevronRight size={13} className="text-fg-muted" />
                    </button>
                  )}
                  <button
                    className="menu-item"
                    onClick={() => {
                      void toggleTimer()
                      close()
                    }}
                  >
                    {timerOnThisTask ? (
                      <>
                        <Square size={14} className="text-red-400" /> <span className="flex-1">Stop timer</span>
                      </>
                    ) : (
                      <>
                        <Play size={14} /> <span className="flex-1">Start timer</span>
                      </>
                    )}
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setShareOpen(true)
                      close()
                    }}
                  >
                    <Share2 size={14} /> <span className="flex-1">Sharing &amp; permissions</span>
                  </button>
                  <div className="my-1 border-t border-ink-700" />
                  <button
                    className="menu-item"
                    onClick={() => {
                      void archive()
                      close()
                    }}
                  >
                    <Archive size={14} /> <span className="flex-1">Archive</span>
                  </button>
                  <button
                    className="menu-item text-red-400 hover:text-red-300"
                    onClick={() => {
                      void remove()
                      close()
                    }}
                  >
                    <Trash2 size={14} /> <span className="flex-1">Delete</span>
                  </button>
                </>
              )
            }}
          </Dropdown>
        </div>
      )}

      {renaming ? (
        <textarea
          autoFocus
          rows={2}
          value={titleDraft}
          onClick={stop}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              saveTitle()
            }
            if (e.key === 'Escape') {
              setTitleDraft(task.title)
              setRenaming(false)
            }
          }}
          onBlur={saveTitle}
          className="w-full resize-none rounded border border-brand bg-ink-900 px-1.5 py-1 text-sm text-fg outline-none"
        />
      ) : (
        <p className="pr-7 text-sm font-medium leading-snug text-fg">
          {task.title}
        </p>
      )}

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <LabelChip key={label} label={label} />
          ))}
        </div>
      )}

      {/* Subtask count */}
      {task.subtask_count > 0 && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-fg-muted">
          <SubtaskIcon size={11} />
          {task.subtask_done_count}/{task.subtask_count} subtasks
        </div>
      )}

      {/* Ghost quick actions (assignee / due / priority) */}
      <div className="mt-2.5 flex items-center gap-1.5" onClick={stop}>
        {canEdit ? (
          <AssigneePicker task={task} size={20} max={3}>
            <GhostButton title="Assign">
              <UserPlus size={12} />
            </GhostButton>
          </AssigneePicker>
        ) : (
          <AvatarStack users={task.assignees} size={20} max={3} />
        )}

        {canEdit ? (
          <DatePicker
            value={task.due_date}
            onChange={(d) => update(d ? { due_date: d } : { clear_due_date: true }, withDueDate(d ?? null))}
          >
            {task.due_date ? (
              <span className={cn('flex cursor-pointer items-center gap-1 text-[11px]', overdue ? 'font-medium text-red-400' : 'text-fg-muted')}>
                <Calendar size={11} />
                {formatDate(task.due_date)}
              </span>
            ) : (
              <span className="flex cursor-pointer items-center">
                <NoDueDateDot title={task.title} size="sm" interactive={false} />
              </span>
            )}
          </DatePicker>
        ) : (
          task.due_date ? (
            <span className="flex items-center gap-1 text-[11px] text-fg-muted">
              <Calendar size={11} />
              {formatDate(task.due_date)}
            </span>
          ) : (
            <NoDueDateDot title={task.title} size="sm" />
          )
        )}

        {canEdit ? (
          <PriorityPicker
            value={task.priority}
            onChange={(p) => update(p ? { priority: p } : { clear_priority: true }, withPriority(p ?? null))}
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

      {/* Inline add-subtask */}
      {addingSub && (
        <div onClick={stop}>
          <SubtaskQuickAdd
            projectId={projectId}
            parentId={task.id}
            statusId={todoStatus?.id}
            taskListQueryKey={taskListQueryKey}
            createGithubIssue={createGithubIssue}
            onDone={() => setAddingSub(false)}
          />
        </div>
      )}

      {shareOpen && (
        <div onClick={stop}>
          <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} taskId={task.id} taskTitle={task.title} />
        </div>
      )}
    </div>
  )
}

function DrillHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      className="menu-item mb-1 border-b border-ink-700 font-semibold text-fg"
      onClick={onBack}
    >
      <ChevronLeft size={14} /> <span className="flex-1">{label}</span>
    </button>
  )
}

function CardIconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Plus-in-a-circle "add subtask" glyph. */
function PlusCircleIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 5.2v5.6M5.2 8h5.6" strokeLinecap="round" />
    </svg>
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

function QuickAdd({
  projectId,
  sprintId,
  statusId,
  taskListQueryKey,
  createGithubIssue = false,
  onDone,
}: {
  projectId: string
  sprintId?: string
  statusId: string
  taskListQueryKey?: readonly unknown[]
  createGithubIssue?: boolean
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()

  const create = async () => {
    if (!title.trim()) return
    try {
      const task = await api.post<Task>(`/projects/${projectId}/tasks`, {
        title: title.trim(),
        status_id: statusId,
        create_github_issue: createGithubIssue,
      })
      if (sprintId) {
        await api.post(`/sprints/${sprintId}/tasks`, { task_ids: [task.id] })
        toast.success(`${task.ref} created and added to sprint`)
        void queryClient.invalidateQueries({ queryKey: ['backlog'] })
        void queryClient.invalidateQueries({ queryKey: ['sprints'] })
      } else {
        toast.success(`${task.ref} created`)
      }
      setTitle('')
      invalidateKanbanTaskQueries(queryClient, taskListQueryKey)
      onDone()
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

function SubtaskQuickAdd({
  projectId,
  parentId,
  statusId,
  taskListQueryKey,
  createGithubIssue = false,
  onDone,
}: {
  projectId: string
  parentId: string
  statusId?: string
  taskListQueryKey?: readonly unknown[]
  createGithubIssue?: boolean
  onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const queryClient = useQueryClient()

  const create = async () => {
    if (!title.trim()) {
      onDone()
      return
    }
    try {
      await api.post(`/projects/${projectId}/tasks`, {
        title: title.trim(),
        parent_task_id: parentId,
        ...(statusId ? { status_id: statusId } : {}),
        create_github_issue: createGithubIssue,
      })
      setTitle('')
      toast.success('Subtask added')
      invalidateKanbanTaskQueries(queryClient, taskListQueryKey)
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-brand/60 bg-ink-900 px-2 py-1.5">
      <CornerUpLeft size={12} className="rotate-180 text-fg-muted" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create()
          if (e.key === 'Escape') onDone()
        }}
        onBlur={() => void create()}
        placeholder="Subtask name"
        className="flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted"
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
