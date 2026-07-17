import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Flag,
  Layers,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Tag,
  UserPlus,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { rememberOpenedTask } from '../../lib/taskListFocus'
import { useRestoreTaskListFocus } from '../../lib/useRestoreTaskListFocus'
import { useTaskPatch, withDueDate, withPriority, withStatus } from '../../lib/taskMutations'
import { buildStatusUpdate } from '../../lib/taskStatusChange'
import type { Comment, CustomStatus, Page, Priority, Task, TaskDetail } from '../../lib/types'
import { cn, formatDate, isOverdue, PRIORITY_COLORS, PRIORITY_LABELS, renderMentions, timeAgo, toMentionMarkup } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { MentionInput } from '../comments/MentionInput'
import { AvatarStack } from '../ui/Avatar'
import { LabelChip, PriorityFlag, StatusIcon, StatusPill } from '../ui/badges'
import { Dropdown } from '../ui/Dropdown'
import { AssigneePicker, CreateAssigneePicker, DatePicker, PriorityPicker, StatusPicker } from './pickers'

export type GroupBy = 'status' | 'priority' | 'none'
export type ColKey = 'assignee' | 'due' | 'priority' | 'status' | 'comments'

export const ALL_COLS: ColKey[] = ['assignee', 'due', 'priority', 'status', 'comments']

const COL_DEFS: Record<ColKey, { label: string; width: string }> = {
  assignee: { label: 'Assignee', width: '140px' },
  due: { label: 'Due date', width: '110px' },
  priority: { label: 'Priority', width: '90px' },
  status: { label: 'Status', width: '120px' },
  comments: { label: 'Comments', width: '80px' },
}

export function gridTemplate(cols: ColKey[]): string {
  return `minmax(280px,1fr) ${cols.map((c) => COL_DEFS[c].width).join(' ')}`
}

interface TaskTableProps {
  projectId: string
  tasks: Task[]
  statuses: CustomStatus[]
  canEdit: boolean
  groupBy?: GroupBy
  cols?: ColKey[]
  createGithubIssue?: boolean
}

interface Group {
  key: string
  pill: React.ReactNode
  tasks: Task[]
  createDefaults: { status_id?: string; priority?: Priority }
}

export function TaskTable({
  projectId,
  tasks,
  statuses,
  canEdit,
  groupBy = 'status',
  cols = ALL_COLS,
  createGithubIssue = false,
}: TaskTableProps) {
  useRestoreTaskListFocus(tasks.length > 0)
  const groups: Group[] = []

  if (groupBy === 'status') {
    for (const status of statuses) {
      const groupTasks = tasks.filter((t) => t.status?.id === status.id)
      if (groupTasks.length > 0 || status.position === 0) {
        groups.push({
          key: status.id,
          pill: <StatusPill status={status} size="md" />,
          tasks: groupTasks,
          createDefaults: { status_id: status.id },
        })
      }
    }
    const unstatused = tasks.filter((t) => !t.status)
    if (unstatused.length > 0) {
      groups.push({ key: 'none', pill: <StatusPill status={null} size="md" />, tasks: unstatused, createDefaults: {} })
    }
  } else if (groupBy === 'priority') {
    const order: (Priority | null)[] = ['urgent', 'high', 'normal', 'low', null]
    for (const priority of order) {
      const groupTasks = tasks.filter((t) => (t.priority ?? null) === priority)
      if (groupTasks.length > 0 || priority === 'normal') {
        groups.push({
          key: priority ?? 'none',
          pill: <PriorityGroupPill priority={priority} />,
          tasks: groupTasks,
          createDefaults: priority ? { priority } : {},
        })
      }
    }
  } else {
    groups.push({
      key: 'all',
      pill: (
        <span className="rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
          All Tasks
        </span>
      ),
      tasks,
      createDefaults: {},
    })
  }

  return (
    <div className="space-y-6 px-6 pb-20">
      {groups.map((group) => (
        <TaskGroup
          key={group.key}
          projectId={projectId}
          group={group}
          cols={cols}
          canEdit={canEdit}
          createGithubIssue={createGithubIssue}
        />
      ))}
    </div>
  )
}

function PriorityGroupPill({ priority }: { priority: Priority | null }) {
  const color = priority ? PRIORITY_COLORS[priority] : '#87909E'
  const label = priority ? PRIORITY_LABELS[priority] : 'No priority'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}
    >
      <Flag size={11} fill={color} />
      {label}
    </span>
  )
}

function TaskGroup({
  projectId,
  group,
  cols,
  canEdit,
  createGithubIssue = false,
}: {
  projectId: string
  group: Group
  cols: ColKey[]
  canEdit: boolean
  createGithubIssue?: boolean
}) {
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="mb-1.5 flex items-center gap-2 py-1">
        <ChevronDown size={14} className={cn('text-fg-muted transition-transform', !open && '-rotate-90')} />
        {group.pill}
        <span className="text-xs text-fg-muted">{group.tasks.length}</span>
      </button>

      {open && (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <div
            className="grid items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted"
            style={{ gridTemplateColumns: gridTemplate(cols) }}
          >
            <span>Name</span>
            {cols.map((c) => (
              <span key={c}>{COL_DEFS[c].label}</span>
            ))}
          </div>
          {group.tasks.map((task) => (
            <TaskRow key={task.id} task={task} canEdit={canEdit} cols={cols} createGithubIssue={createGithubIssue} />
          ))}
          {canEdit &&
            (adding ? (
              <InlineCreateRow
                projectId={projectId}
                defaults={group.createDefaults}
                onDone={() => setAdding(false)}
                createGithubIssue={createGithubIssue}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-fg-muted transition-colors hover:bg-ink-850 hover:text-fg-secondary"
              >
                <Plus size={14} /> Add Task
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

/* ---------------- Task row with hover actions ---------------- */

export function TaskRow({
  task,
  canEdit,
  cols = ALL_COLS,
  depth = 0,
  createGithubIssue = false,
}: {
  task: Task
  canEdit: boolean
  cols?: ColKey[]
  depth?: number
  createGithubIssue?: boolean
}) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [addingSub, setAddingSub] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(task.title)

  useEffect(() => setDraft(task.title), [task.title])

  const patch = useTaskPatch()
  const update = (body: Record<string, unknown>, apply?: (t: Task) => Task) =>
    patch.mutate({ taskId: task.id, body, apply })

  const overdue = isOverdue(task.due_date, task.completed_at)
  const isSubtask = !!task.parent_task_id || depth > 0
  const statusColor = task.status?.color ?? '#87909E'

  return (
    <>
      <div
        data-task-id={task.id}
        className="group grid cursor-pointer items-center gap-2 border-b border-ink-700/60 bg-ink-900 px-4 py-2 transition-colors last:border-b-0 hover:bg-ink-850"
        style={{ gridTemplateColumns: gridTemplate(cols) }}
        onClick={() => {
          if (renaming) return
          rememberOpenedTask(task.id)
          navigate(`/app/tasks/${task.id}`)
        }}
      >
        {/* Name cell */}
        <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 26 }}>
          {/* Expand caret (hover, or visible when has subtasks) */}
          <button
            type="button"
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted transition-all hover:bg-ink-750 hover:text-fg',
              task.subtask_count > 0 || expanded
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100',
              isSubtask && 'invisible',
            )}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            title="Subtasks"
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>

          {/* Status icon (click to change) */}
          <span onClick={(e) => e.stopPropagation()} className="inline-flex h-5 shrink-0 items-center">
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
              <span className="flex h-5 w-5 items-center justify-center">
                <StatusIcon category={task.status?.category} color={statusColor} size={14} />
              </span>
            )}
          </span>

          {/* Title / rename */}
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (draft.trim() && draft !== task.title) {
                    const title = draft.trim()
                    update({ title }, (t) => ({ ...t, title }))
                  }
                  setRenaming(false)
                }
                if (e.key === 'Escape') {
                  setDraft(task.title)
                  setRenaming(false)
                }
              }}
              onBlur={() => {
                if (draft.trim() && draft !== task.title) {
                  const title = draft.trim()
                  update({ title }, (t) => ({ ...t, title }))
                }
                setRenaming(false)
              }}
              className="min-w-0 flex-1 rounded border border-brand bg-ink-800 px-1.5 py-0.5 text-sm leading-5 text-fg outline-none"
            />
          ) : (
            <span className="truncate text-sm leading-5 text-fg">{task.title}</span>
          )}

          {task.subtask_count > 0 && (
            <span className="flex h-5 shrink-0 items-center gap-1 rounded bg-ink-750 px-1.5 text-[10px] text-fg-secondary">
              <Layers size={9} className="opacity-70" />
              {task.subtask_done_count}/{task.subtask_count}
            </span>
          )}
          {task.labels.slice(0, 2).map((label) => (
            <LabelChip key={label} label={label} />
          ))}

          {/* Hover actions: add subtask / labels / rename */}
          {canEdit && !renaming && (
            <span
              className="flex h-5 shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              {!isSubtask && (
                <button
                  type="button"
                  className="flex h-5 w-5 items-center justify-center rounded border border-ink-600 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                  title="Add subtask"
                  onClick={() => {
                    setExpanded(true)
                    setAddingSub(true)
                  }}
                >
                  <Plus size={11} />
                </button>
              )}
              <LabelQuickEditor task={task} onSave={(labels) => update({ labels }, (t) => ({ ...t, labels }))} />
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded border border-ink-600 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                title="Rename"
                onClick={() => setRenaming(true)}
              >
                <Pencil size={11} />
              </button>
            </span>
          )}
        </div>

        {/* Data columns */}
        {cols.map((col) => (
          <div key={col} onClick={(e) => e.stopPropagation()}>
            {col === 'assignee' &&
              (canEdit ? (
                <AssigneePicker task={task} size={24}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-ink-600 text-fg-muted opacity-0 transition-opacity hover:border-fg-muted hover:text-fg-secondary group-hover:opacity-100">
                    <UserPlus size={12} />
                  </span>
                </AssigneePicker>
              ) : (
                <AvatarStack users={task.assignees} size={24} />
              ))}

            {col === 'due' &&
              (canEdit ? (
                <DatePicker
                  value={task.due_date}
                  onChange={(d) => update(d ? { due_date: d } : { clear_due_date: true }, withDueDate(d ?? null))}
                >
                  {task.due_date ? (
                    <span className={cn('cursor-pointer text-xs', overdue ? 'font-medium text-red-400' : 'text-fg-secondary')}>
                      {formatDate(task.due_date)}
                    </span>
                  ) : (
                    <span className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-dashed border-ink-600 text-fg-muted opacity-0 transition-opacity hover:border-fg-muted hover:text-fg-secondary group-hover:opacity-100">
                      <Calendar size={12} />
                    </span>
                  )}
                </DatePicker>
              ) : (
                <span className="text-xs text-fg-secondary">{formatDate(task.due_date)}</span>
              ))}

            {col === 'priority' &&
              (canEdit ? (
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
              ))}

            {col === 'status' &&
              (canEdit ? (
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
              ))}

            {col === 'comments' && (
              <CommentPopover taskId={task.id} projectId={task.project_id} count={task.comment_count} />
            )}
          </div>
        ))}
      </div>

      {/* Expanded subtasks */}
      {expanded && !isSubtask && (
        <SubtaskRows
          task={task}
          cols={cols}
          canEdit={canEdit}
          adding={addingSub}
          onDoneAdding={() => setAddingSub(false)}
          createGithubIssue={createGithubIssue}
        />
      )}
    </>
  )
}

function SubtaskRows({
  task,
  cols,
  canEdit,
  adding,
  onDoneAdding,
  createGithubIssue = false,
}: {
  task: Task
  cols: ColKey[]
  canEdit: boolean
  adding: boolean
  onDoneAdding: () => void
  createGithubIssue?: boolean
}) {
  const { data } = useQuery({
    queryKey: ['task', task.id],
    queryFn: () => api.get<TaskDetail>(`/tasks/${task.id}`),
  })

  return (
    <>
      {(data?.subtasks ?? []).map((subtask) => (
        <TaskRow key={subtask.id} task={subtask} canEdit={canEdit} cols={cols} depth={1} />
      ))}
      {adding && (
        <InlineCreateRow
          projectId={task.project_id}
          defaults={{ status_id: undefined }}
          parentTaskId={task.id}
          depth={1}
          onDone={onDoneAdding}
          createGithubIssue={createGithubIssue}
          onCreated={() => {
            void 0
          }}
        />
      )}
    </>
  )
}

/* ---------------- Label quick editor ---------------- */

function LabelQuickEditor({ task, onSave }: { task: Task; onSave: (labels: string[]) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <Dropdown
      width="w-56"
      trigger={
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded border border-ink-600 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
          title="Labels"
        >
          <Tag size={11} />
        </button>
      }
    >
      {() => (
        <div className="p-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Labels</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {task.labels.map((label) => (
              <span key={label} className="inline-flex items-center gap-0.5 rounded-md bg-ink-750 px-1.5 py-0.5 text-[11px] text-fg-secondary">
                {label}
                <button
                  className="text-fg-muted hover:text-red-400"
                  onClick={() => onSave(task.labels.filter((l) => l !== label))}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
            {task.labels.length === 0 && <span className="text-[11px] text-fg-muted">No labels yet</span>}
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                onSave([...task.labels, draft.trim()])
                setDraft('')
              }
            }}
            placeholder="Add label + Enter"
            className="w-full rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs text-fg outline-none focus:border-brand"
          />
        </div>
      )}
    </Dropdown>
  )
}

/* ---------------- Inline create row (ClickUp style) ---------------- */

export function InlineCreateRow({
  projectId,
  defaults,
  parentTaskId,
  depth = 0,
  onDone,
  onCreated,
  createGithubIssue = false,
}: {
  projectId: string
  defaults: { status_id?: string; priority?: Priority }
  parentTaskId?: string
  depth?: number
  onDone: () => void
  onCreated?: (task: Task) => void
  createGithubIssue?: boolean
}) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority | null>(defaults.priority ?? null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>(`/projects/${projectId}/tasks`, {
        title: title.trim(),
        create_github_issue: createGithubIssue,
        ...(defaults.status_id ? { status_id: defaults.status_id } : {}),
        ...(priority ? { priority } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(assigneeIds.length ? { assignee_ids: assigneeIds } : {}),
        ...(parentTaskId ? { parent_task_id: parentTaskId } : {}),
      }),
    onSuccess: (task) => {
      setTitle('')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      if (parentTaskId) void queryClient.invalidateQueries({ queryKey: ['task', parentTaskId] })
      onCreated?.(task)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="flex items-center gap-2 border-b border-ink-700/60 bg-ink-850 px-4 py-2 last:border-b-0">
      <span style={{ paddingLeft: depth * 26 }} className="ml-5 flex items-center">
        <StatusIcon category="todo" color="#87909E" size={15} />
      </span>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim()) create.mutate()
          if (e.key === 'Escape') onDone()
        }}
        placeholder={parentTaskId ? 'Subtask name' : 'Task Name'}
        className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
      />
      <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <CreateAssigneePicker projectId={projectId} value={assigneeIds} onChange={setAssigneeIds}>
          <button
            className={cn(
              'flex items-center gap-1 rounded-md border border-ink-600 p-1.5 transition-colors hover:border-fg-muted',
              assigneeIds.length ? 'text-brand' : 'text-fg-muted hover:text-fg',
            )}
            title="Assignees"
          >
            <UserPlus size={12} />
            {assigneeIds.length > 0 && <span className="text-[10px] font-semibold">{assigneeIds.length}</span>}
          </button>
        </CreateAssigneePicker>
        <PriorityPicker value={priority} onChange={setPriority}>
          <button
            className={cn(
              'rounded-md border border-ink-600 p-1.5 transition-colors hover:border-fg-muted',
              priority ? '' : 'text-fg-muted hover:text-fg',
            )}
            title="Priority"
          >
            <Flag size={12} style={priority ? { color: PRIORITY_COLORS[priority] } : undefined} fill={priority ? PRIORITY_COLORS[priority] : 'none'} />
          </button>
        </PriorityPicker>
        <DatePicker value={dueDate} onChange={setDueDate} closeOnSelect={false}>
          <button
            className="flex items-center gap-1 rounded-md border border-ink-600 p-1.5 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
            title="Due date"
          >
            <Calendar size={12} />
            {dueDate && <span className="text-[10px] text-fg-secondary">{formatDate(dueDate)}</span>}
          </button>
        </DatePicker>
        <button onClick={onDone} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg">
          Cancel
        </button>
        <button
          onClick={() => title.trim() && create.mutate()}
          disabled={!title.trim() || create.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition-colors hover:bg-gray-200 disabled:opacity-50"
        >
          {create.isPending && <Loader2 size={12} className="animate-spin" />}
          {create.isPending ? 'Saving…' : 'Save ↵'}
        </button>
      </span>
    </div>
  )
}

/** Strip mention markup for compact list display. */
function plainComment(body: string): string {
  return renderMentions(body)
}

function CommentPopover({
  taskId,
  projectId,
  count,
}: {
  taskId: string
  projectId: string
  count: number
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const [contentVersion, setContentVersion] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const anchorRectRef = useRef<DOMRect | null>(null)

  const openPanel = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    anchorRectRef.current = rect
    setContentVersion(0)
    // Seed a below-trigger position, then refine once the panel mounts.
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(12, Math.min(rect.right - 320, window.innerWidth - 320 - 12)),
      maxHeight: Math.max(180, window.innerHeight - rect.bottom - 20),
    })
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    const rect = anchorRectRef.current
    const panel = panelRef.current
    if (!rect) return

    const panelWidth = 320
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const gap = 8
    const margin = 12
    const naturalHeight = panel?.offsetHeight || 280
    const spaceBelow = viewportH - rect.bottom - gap - margin
    const spaceAbove = rect.top - gap - margin
    // Prefer downward consistently; only flip when below is clearly too tight.
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow + 40
    const maxHeight = Math.max(180, openUp ? spaceAbove : spaceBelow)
    const height = Math.min(naturalHeight, maxHeight)
    // Stay glued to the trigger — do not clamp into a free-floating position.
    const top = openUp ? rect.top - gap - height : rect.bottom + gap
    const left = Math.max(margin, Math.min(rect.right - panelWidth, viewportW - panelWidth - margin))
    setPosition({ top, left, maxHeight })
  }, [open, contentVersion])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setPosition(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="flex h-5 items-center gap-1 rounded px-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
        title="Comments"
        onClick={openPanel}
      >
        <MessageSquare size={13} />
        <span className="text-xs leading-none">{count || ''}</span>
      </button>
      {open &&
        position &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[200]"
              onClick={() => {
                setOpen(false)
                setPosition(null)
              }}
              aria-hidden
            />
            <div
              ref={panelRef}
              className="menu-panel fixed z-[210] w-80 overflow-y-auto shadow-popover"
              style={{ top: position.top, left: position.left, maxHeight: position.maxHeight }}
              onClick={(e) => e.stopPropagation()}
            >
              <CommentPopoverBody
                taskId={taskId}
                projectId={projectId}
                onClose={() => {
                  setOpen(false)
                  setPosition(null)
                }}
                onContentReady={() => setContentVersion((v) => v + 1)}
              />
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

function CommentPopoverBody({
  taskId,
  projectId,
  onClose,
  onContentReady,
}: {
  taskId: string
  projectId: string
  onClose?: () => void
  onContentReady?: () => void
}) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [mentionMap, setMentionMap] = useState<Map<string, string>>(new Map())
  const { data, isLoading } = useQuery({
    queryKey: ['comments', taskId],
    queryFn: () => api.get<Page<Comment>>(`/tasks/${taskId}/comments?page_size=50`),
  })
  const post = useMutation({
    mutationFn: () =>
      api.post<Comment>(`/tasks/${taskId}/comments`, {
        body: toMentionMarkup(text.trim(), mentionMap),
        parent_comment_id: null,
      }),
    onSuccess: () => {
      setText('')
      setMentionMap(new Map())
      void queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const comments = data?.items ?? []
  const onContentReadyRef = useRef(onContentReady)
  onContentReadyRef.current = onContentReady

  useLayoutEffect(() => {
    if (isLoading) return
    onContentReadyRef.current?.()
  }, [isLoading, comments.length])

  const rememberMention = (name: string, userId: string) =>
    setMentionMap((m) => new Map(m).set(name, userId))

  const submit = () => {
    if (text.trim() && !post.isPending) post.mutate()
  }

  return (
    <div className="overflow-visible p-2.5">
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Comments</p>
        {onClose && (
          <button type="button" className="rounded p-1 text-fg-muted hover:bg-ink-750 hover:text-fg" onClick={onClose}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto px-1">
        {isLoading ? (
          <p className="py-2 text-xs text-fg-muted">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="py-2 text-xs text-fg-muted">No comments yet. Start the conversation.</p>
        ) : (
          comments.slice(-20).map((c) => (
            <div key={c.id} className="rounded-lg bg-ink-850 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-fg">{c.author?.full_name ?? 'Someone'}</span>
                <span className="text-[10px] text-fg-muted">{timeAgo(c.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-fg-secondary">{plainComment(c.body)}</p>
            </div>
          ))
        )}
      </div>
      <div className="mt-2 flex items-end gap-1.5 overflow-visible px-1">
        <div className="min-w-0 flex-1 overflow-visible">
          <MentionInput
            projectId={projectId}
            value={text}
            onChange={setText}
            onMention={rememberMention}
            onSubmit={submit}
            placeholder="Write a comment… use @ to mention"
            autoFocus
            compact
          />
        </div>
        <button
          type="button"
          className="btn-primary shrink-0 !px-3 !py-2"
          disabled={!text.trim() || post.isPending}
          onClick={submit}
          title="Send"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
