import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Flag,
  GitBranch,
  MessageSquare,
  Pencil,
  Plus,
  Tag,
  UserPlus,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import type { CustomStatus, Priority, Task, TaskDetail } from '../../lib/types'
import { cn, formatDate, isOverdue, PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { AvatarStack } from '../ui/Avatar'
import { LabelChip, PriorityFlag, StatusPill } from '../ui/badges'
import { Dropdown } from '../ui/Dropdown'
import { AssigneePicker, DatePicker, PriorityPicker, StatusPicker } from './pickers'

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
}: TaskTableProps) {
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
        <TaskGroup key={group.key} projectId={projectId} group={group} cols={cols} canEdit={canEdit} />
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
}: {
  projectId: string
  group: Group
  cols: ColKey[]
  canEdit: boolean
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
            <TaskRow key={task.id} task={task} canEdit={canEdit} cols={cols} />
          ))}
          {canEdit &&
            (adding ? (
              <InlineCreateRow
                projectId={projectId}
                defaults={group.createDefaults}
                onDone={() => setAdding(false)}
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
}: {
  task: Task
  canEdit: boolean
  cols?: ColKey[]
  depth?: number
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [addingSub, setAddingSub] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(task.title)

  useEffect(() => setDraft(task.title), [task.title])

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<Task>(`/tasks/${task.id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const overdue = isOverdue(task.due_date, task.completed_at)
  const isSubtask = !!task.parent_task_id || depth > 0
  const statusColor = task.status?.color ?? '#87909E'

  return (
    <>
      <div
        className="group grid cursor-pointer items-center gap-2 border-b border-ink-700/60 bg-ink-900 px-4 py-2 transition-colors last:border-b-0 hover:bg-ink-850"
        style={{ gridTemplateColumns: gridTemplate(cols) }}
        onClick={() => !renaming && navigate(`/app/tasks/${task.id}`)}
      >
        {/* Name cell */}
        <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 26 }}>
          {/* Expand caret (hover, or visible when has subtasks) */}
          <button
            className={cn(
              'shrink-0 rounded p-0.5 text-fg-muted transition-all hover:bg-ink-750 hover:text-fg',
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

          {/* Status ring */}
          <span onClick={(e) => e.stopPropagation()} className="shrink-0">
            {canEdit ? (
              <StatusPicker
                projectId={task.project_id}
                value={task.status}
                onChange={(statusId) => update.mutate({ status_id: statusId })}
              >
                <span
                  className="block h-3.5 w-3.5 cursor-pointer rounded-full border-2 border-dashed transition-transform hover:scale-110"
                  style={{ borderColor: statusColor }}
                  title={task.status?.name ?? 'Set status'}
                />
              </StatusPicker>
            ) : (
              <span className="block h-3.5 w-3.5 rounded-full border-2 border-dashed" style={{ borderColor: statusColor }} />
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
                  if (draft.trim() && draft !== task.title) update.mutate({ title: draft.trim() })
                  setRenaming(false)
                }
                if (e.key === 'Escape') {
                  setDraft(task.title)
                  setRenaming(false)
                }
              }}
              onBlur={() => {
                if (draft.trim() && draft !== task.title) update.mutate({ title: draft.trim() })
                setRenaming(false)
              }}
              className="min-w-0 flex-1 rounded border border-brand bg-ink-800 px-1.5 py-0.5 text-sm text-fg outline-none"
            />
          ) : (
            <span
              className={cn(
                'truncate text-sm',
                task.completed_at ? 'text-fg-muted line-through' : 'text-fg',
              )}
            >
              {task.title}
            </span>
          )}

          {task.subtask_count > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-ink-750 px-1.5 py-0.5 text-[10px] text-fg-secondary">
              <GitBranch size={10} />
              {task.subtask_done_count}/{task.subtask_count}
            </span>
          )}
          {task.labels.slice(0, 2).map((label) => (
            <LabelChip key={label} label={label} />
          ))}

          {/* Hover actions: add subtask / labels / rename */}
          {canEdit && !renaming && (
            <span
              className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              {!isSubtask && (
                <button
                  className="rounded-md border border-ink-600 p-1 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                  title="Add subtask"
                  onClick={() => {
                    setExpanded(true)
                    setAddingSub(true)
                  }}
                >
                  <Plus size={11} />
                </button>
              )}
              <LabelQuickEditor task={task} onSave={(labels) => update.mutate({ labels })} />
              <button
                className="rounded-md border border-ink-600 p-1 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
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
                <AssigneePicker task={task}>
                  {task.assignees.length > 0 ? (
                    <AvatarStack users={task.assignees} size={24} />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-ink-600 text-fg-muted opacity-0 transition-opacity hover:border-fg-muted hover:text-fg-secondary group-hover:opacity-100">
                      <UserPlus size={12} />
                    </span>
                  )}
                </AssigneePicker>
              ) : (
                <AvatarStack users={task.assignees} size={24} />
              ))}

            {col === 'due' &&
              (canEdit ? (
                <DatePicker
                  value={task.due_date}
                  onChange={(d) => update.mutate(d ? { due_date: d } : { clear_due_date: true })}
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
                  onChange={(p) => update.mutate(p ? { priority: p } : { clear_priority: true })}
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
                  onChange={(statusId) => update.mutate({ status_id: statusId })}
                >
                  <span className="inline-flex cursor-pointer">
                    <StatusPill status={task.status} />
                  </span>
                </StatusPicker>
              ) : (
                <StatusPill status={task.status} />
              ))}

            {col === 'comments' && (
              <span className="flex items-center gap-1 text-fg-muted">
                <MessageSquare size={13} />
                <span className="text-xs">{task.comment_count || ''}</span>
              </span>
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
}: {
  task: Task
  cols: ColKey[]
  canEdit: boolean
  adding: boolean
  onDoneAdding: () => void
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
          className="rounded-md border border-ink-600 p-1 text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
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
}: {
  projectId: string
  defaults: { status_id?: string; priority?: Priority }
  parentTaskId?: string
  depth?: number
  onDone: () => void
  onCreated?: (task: Task) => void
}) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority | null>(defaults.priority ?? null)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>(`/projects/${projectId}/tasks`, {
        title: title.trim(),
        ...(defaults.status_id ? { status_id: defaults.status_id } : {}),
        ...(priority ? { priority } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(parentTaskId ? { parent_task_id: parentTaskId } : {}),
      }),
    onSuccess: (task) => {
      setTitle('')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      if (parentTaskId) void queryClient.invalidateQueries({ queryKey: ['task', parentTaskId] })
      onCreated?.(task)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <div className="flex items-center gap-2 border-b border-ink-700/60 bg-ink-850 px-4 py-2 last:border-b-0">
      <span style={{ paddingLeft: depth * 26 }} className="flex items-center">
        <span className="ml-5 block h-3.5 w-3.5 rounded-full border-2 border-dashed border-ink-600" />
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
        <DatePicker value={dueDate} onChange={setDueDate}>
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
          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 transition-colors hover:bg-gray-200 disabled:opacity-50"
        >
          Save ↵
        </button>
      </span>
    </div>
  )
}
