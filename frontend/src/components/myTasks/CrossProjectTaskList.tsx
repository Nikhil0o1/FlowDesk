import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  GitBranch,
  Layers,
  ListFilter,
  Search,
  Settings2,
  Target,
  Trash2,
} from 'lucide-react'

import { FavoriteButton } from '../favorites/FavoriteButton'
import { InboxToggle } from '../inbox/InboxToggle'
import type { FavoriteTarget } from '../../lib/favorites'
import { rememberOpenedTask } from '../../lib/taskListFocus'
import { useRestoreTaskListFocus } from '../../lib/useRestoreTaskListFocus'
import { TaskRow, type ColKey, type GroupBy } from '../tasks/TaskTable'
import { PriorityFlag, StatusPill } from '../ui/badges'
import { Dropdown } from '../ui/Dropdown'
import { useCurrentContext, useProjects } from '../../lib/queries'
import type { Task } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useUIStore } from '../../stores/ui'

const CATEGORY_ORDER: Record<string, number> = {
  in_progress: 0,
  todo: 1,
  done: 2,
  cancelled: 3,
}

const DEFAULT_COLS: ColKey[] = ['priority', 'due', 'status']

const ASSIGNED_SETTING_ROWS = [
  ['showEmptyStatuses', 'Show empty statuses'],
  ['wrapText', 'Wrap text'],
  ['showTaskLocations', 'Show task locations'],
  ['showSubtaskParentNames', 'Show subtask parent names'],
  ['showClosedTasks', 'Show closed tasks'],
] as const

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'none', label: 'None' },
]

type StatusGroup = {
  key: string
  label: string
  pill: React.ReactNode
  tasks: Task[]
  category: string
}

function groupTasks(tasks: Task[], groupBy: GroupBy): StatusGroup[] {
  if (groupBy === 'none') {
    return [
      {
        key: 'all',
        label: 'All Tasks',
        pill: (
          <span className="rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            All Tasks
          </span>
        ),
        tasks,
        category: 'todo',
      },
    ]
  }

  if (groupBy === 'priority') {
    const order = ['urgent', 'high', 'normal', 'low', 'none'] as const
    return order
      .map((priority) => {
        const groupTasksList = tasks.filter((t) => (t.priority ?? 'none') === priority)
        if (groupTasksList.length === 0 && priority !== 'normal') return null
        const label = priority === 'none' ? 'No priority' : priority
        return {
          key: priority,
          label,
          pill: (
            <span className="rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              {label}
            </span>
          ),
          tasks: groupTasksList,
          category: 'todo',
        }
      })
      .filter((g) => g != null) as StatusGroup[]
  }

  const map = new Map<string, StatusGroup>()
  for (const task of tasks) {
    const status = task.status
    const key = status ? `${status.category}::${status.name.toLowerCase()}` : 'none::no status'
    const existing = map.get(key)
    if (existing) {
      existing.tasks.push(task)
      continue
    }
    map.set(key, {
      key,
      label: status?.name ?? 'No status',
      pill: <StatusPill status={status} size="md" />,
      tasks: [task],
      category: status?.category ?? 'todo',
    })
  }

  return [...map.values()].sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 9
    const cb = CATEGORY_ORDER[b.category] ?? 9
    if (ca !== cb) return ca - cb
    return a.label.localeCompare(b.label)
  })
}

function sortStatusGroups(groups: StatusGroup[], ascending: boolean): StatusGroup[] {
  return [...groups].sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 9
    const cb = CATEGORY_ORDER[b.category] ?? 9
    if (ca !== cb) return ascending ? ca - cb : cb - ca
    return ascending ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label)
  })
}

function GroupByPopoverContent({
  groupBy,
  onGroupByChange,
  groupAscending,
  onGroupAscendingChange,
  alsoGroupByList,
  onAlsoGroupByListChange,
  onReset,
}: {
  groupBy: GroupBy
  onGroupByChange: (value: GroupBy) => void
  groupAscending: boolean
  onGroupAscendingChange: (value: boolean) => void
  alsoGroupByList: boolean
  onAlsoGroupByListChange: (value: boolean) => void
  onReset: () => void
}) {
  return (
    <div className="p-3" onMouseDown={(e) => e.stopPropagation()}>
      <p className="mb-2 text-xs font-medium text-fg-secondary">Group by</p>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Target size={13} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-fg-muted" />
          <div className="flex flex-col gap-0.5 rounded-lg border border-ink-700 bg-ink-900 py-1 pl-8 pr-1">
            {GROUP_BY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={cn(
                  'rounded px-2 py-1 text-left text-xs transition-colors',
                  groupBy === o.value ? 'bg-brand-soft font-medium text-brand' : 'text-fg-secondary hover:bg-ink-850',
                )}
                onClick={() => onGroupByChange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative min-w-0 flex-1">
          {groupAscending ? (
            <ArrowDownAZ size={13} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-fg-muted" />
          ) : (
            <ArrowUpAZ size={13} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-fg-muted" />
          )}
          <div className="flex flex-col gap-0.5 rounded-lg border border-ink-700 bg-ink-900 py-1 pl-8 pr-1">
            <button
              type="button"
              className={cn(
                'rounded px-2 py-1 text-left text-xs transition-colors',
                groupAscending ? 'bg-brand-soft font-medium text-brand' : 'text-fg-secondary hover:bg-ink-850',
              )}
              onClick={() => onGroupAscendingChange(true)}
            >
              Ascending
            </button>
            <button
              type="button"
              className={cn(
                'rounded px-2 py-1 text-left text-xs transition-colors',
                !groupAscending ? 'bg-brand-soft font-medium text-brand' : 'text-fg-secondary hover:bg-ink-850',
              )}
              onClick={() => onGroupAscendingChange(false)}
            >
              Descending
            </button>
          </div>
        </div>
        <button type="button" className="btn-ghost !p-2 text-fg-muted" title="Reset grouping" onClick={onReset}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-700 pt-3">
        <span className="text-sm text-fg-secondary">Also group by List</span>
        <InboxToggle accent="amber" checked={alsoGroupByList} onChange={onAlsoGroupByListChange} />
      </div>
    </div>
  )
}

export function CrossProjectTaskList({
  tasks,
  showSubtasks,
  includeCompleted,
  onIncludeCompletedChange,
  emptyDescription,
  variant = 'page',
  maxHeight,
  onAddTask,
}: {
  tasks: Task[]
  showSubtasks: boolean
  includeCompleted: boolean
  onIncludeCompletedChange: (value: boolean) => void
  emptyDescription: string
  /** `embedded` = compact icon toolbar for My Tasks dashboard card. */
  variant?: 'page' | 'embedded'
  maxHeight?: string
  /** Header / per-group "+" opens create-task flow. */
  onAddTask?: () => void
}) {
  useRestoreTaskListFocus(tasks.length > 0)
  const [localGroupBy, setLocalGroupBy] = useState<GroupBy>('status')
  const [subtasks, setSubtasks] = useState(showSubtasks)
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const embedded = variant === 'embedded'
  const cardSettings = useUIStore((s) => s.assignedToMeCardSettings)
  const setCardSetting = useUIStore((s) => s.setAssignedToMeCardSetting)
  const groupBy = embedded ? cardSettings.groupBy : localGroupBy
  const setGroupBy = (value: GroupBy) => {
    if (embedded) setCardSetting('groupBy', value)
    else setLocalGroupBy(value)
  }
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects.data ?? []) map.set(p.id, p.name)
    return map
  }, [projects.data])

  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tasks) map.set(t.id, t.title)
    return map
  }, [tasks])

  const filtered = useMemo(() => {
    let list = tasks
    if (!includeCompleted) list = list.filter((t) => !t.completed_at)
    const showSubs = embedded ? cardSettings.subtasksExpanded : subtasks
    if (!showSubs) list = list.filter((t) => !t.parent_task_id)
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter((t) => t.title.toLowerCase().includes(needle) || t.ref.toLowerCase().includes(needle))
    }
    return list
  }, [tasks, includeCompleted, subtasks, embedded, cardSettings.subtasksExpanded, q])

  const groups = useMemo(() => {
    let list = groupTasks(filtered, groupBy)
    if (embedded && !cardSettings.showEmptyStatuses) {
      list = list.filter((g) => g.tasks.length > 0)
    }
    if (groupBy === 'status') {
      list = sortStatusGroups(list, cardSettings.groupAscending)
    } else if (groupBy === 'priority' && !cardSettings.groupAscending) {
      list = [...list].reverse()
    }
    return list
  }, [filtered, groupBy, embedded, cardSettings.showEmptyStatuses, cardSettings.groupAscending])

  const resetGrouping = () => {
    setGroupBy('status')
    setCardSetting('groupAscending', true)
    setCardSetting('alsoGroupByList', false)
  }

  const groupByPopover = (close?: () => void) => (
    <GroupByPopoverContent
      groupBy={groupBy}
      onGroupByChange={(value) => {
        setGroupBy(value)
        close?.()
      }}
      groupAscending={cardSettings.groupAscending}
      onGroupAscendingChange={(value) => setCardSetting('groupAscending', value)}
      alsoGroupByList={cardSettings.alsoGroupByList}
      onAlsoGroupByListChange={(value) => setCardSetting('alsoGroupByList', value)}
      onReset={() => {
        resetGrouping()
        close?.()
      }}
    />
  )

  const subtasksExpanded = embedded ? cardSettings.subtasksExpanded : subtasks

  const groupMenu = (close: () => void) =>
    (['status', 'priority', 'none'] as GroupBy[]).map((option) => (
      <button
        key={option}
        className="menu-item flex items-center justify-between"
        onClick={() => {
          setGroupBy(option)
          close()
        }}
      >
        {option === 'none' ? 'None' : option[0].toUpperCase() + option.slice(1)}
        {groupBy === option && <Check size={14} className="text-brand" />}
      </button>
    ))

  const settingsMenu = (close: () => void) => (
    <div className="py-1">
      <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Customize view</p>
      {embedded
        ? ASSIGNED_SETTING_ROWS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-sm text-fg-secondary">{label}</span>
              <InboxToggle
                accent="amber"
                checked={
                  key === 'showClosedTasks' ? includeCompleted : cardSettings[key as keyof typeof cardSettings] === true
                }
                onChange={(value) => {
                  if (key === 'showClosedTasks') onIncludeCompletedChange(value)
                  else setCardSetting(key, value)
                }}
              />
            </div>
          ))
        : (
          <>
            <button
              className="menu-item flex items-center justify-between"
              onClick={() => setSubtasks((v) => !v)}
            >
              Subtasks
              <span className={cn('text-xs', subtasks ? 'text-brand' : 'text-fg-muted')}>{subtasks ? 'On' : 'Off'}</span>
            </button>
            <button
              className="menu-item flex items-center justify-between"
              onClick={() => onIncludeCompletedChange(!includeCompleted)}
            >
              Show closed tasks
              <span className={cn('text-xs', includeCompleted ? 'text-brand' : 'text-fg-muted')}>
                {includeCompleted ? 'On' : 'Off'}
              </span>
            </button>
            <p className="mt-1 border-t border-ink-700 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
              Group
            </p>
            {groupMenu(close)}
          </>
        )}
    </div>
  )

  const groupByLabel = GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'Status'

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', embedded && 'h-full')}>
      {embedded ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-ink-700/60 px-3 py-1.5">
          <Dropdown
            align="left"
            width="w-72"
            trigger={
              <button
                type="button"
                className={cn(
                  'rounded-full p-2 transition-colors',
                  groupBy !== 'none' ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:bg-ink-850 hover:text-fg',
                )}
                title={`Grouping by: ${groupByLabel}`}
                aria-label={`Grouping by: ${groupByLabel}`}
              >
                <Layers size={14} />
              </button>
            }
          >
            {groupByPopover}
          </Dropdown>
          <button
            type="button"
            className={cn(
              'rounded-full p-2 transition-colors',
              subtasksExpanded ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:bg-ink-850 hover:text-fg',
            )}
            title={`Subtasks: ${subtasksExpanded ? 'Expanded' : 'Collapsed'}`}
            aria-label={`Subtasks: ${subtasksExpanded ? 'Expanded' : 'Collapsed'}`}
            onClick={() => setCardSetting('subtasksExpanded', !subtasksExpanded)}
          >
            <GitBranch size={14} />
          </button>
          <span className="flex-1" />
          <Dropdown
            align="right"
            width="w-72"
            trigger={
              <button type="button" className="btn-ghost !p-2" title="Quickly filter your tasks">
                <ListFilter size={15} />
              </button>
            }
          >
            {groupByPopover}
          </Dropdown>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5',
              includeCompleted ? 'border-brand/40 bg-brand-soft' : 'border-ink-600 bg-ink-900',
            )}
            title={includeCompleted ? 'Quickly hide closed tasks' : 'Quickly show closed tasks'}
            onClick={() => onIncludeCompletedChange(!includeCompleted)}
          >
            <span className={cn('rounded-full p-1', includeCompleted && 'bg-brand/20')}>
              <Check size={12} className={includeCompleted ? 'text-brand' : 'text-fg-muted'} />
            </span>
            <span className={cn('rounded-full p-1', !includeCompleted && 'bg-ink-700')}>
              <CircleX size={12} className={!includeCompleted ? 'text-fg' : 'text-fg-muted/40'} />
            </span>
          </button>
          <span className="mx-0.5 h-5 w-px bg-ink-700" aria-hidden />
          {searchOpen ? (
            <div className="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 px-2">
              <Search size={13} className="text-fg-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-28 bg-transparent py-1.5 text-xs text-fg outline-none"
              />
            </div>
          ) : (
            <button type="button" className="btn-ghost !p-2" title="Search" onClick={() => setSearchOpen(true)}>
              <Search size={15} />
            </button>
          )}
          <Dropdown
            align="right"
            width="w-72"
            trigger={
              <button type="button" className="btn-ghost !p-2" title="Customize your view">
                <Settings2 size={15} />
              </button>
            }
          >
            {settingsMenu}
          </Dropdown>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 px-6 py-3">
          <Dropdown
            trigger={
              <button className="btn-secondary !py-1.5 text-xs">
                Group: {groupBy === 'none' ? 'None' : groupBy[0].toUpperCase() + groupBy.slice(1)}
              </button>
            }
          >
            {groupMenu}
          </Dropdown>
          <button
            className={cn('btn-secondary !py-1.5 text-xs', subtasks && 'border-brand/40 bg-brand-soft')}
            onClick={() => setSubtasks((v) => !v)}
          >
            <Layers size={13} className="mr-1 inline" />
            Subtasks
          </button>
          <span className="flex-1" />
          <button
            className={cn('btn-secondary !py-1.5 text-xs', includeCompleted && 'border-brand/40 bg-brand-soft')}
            onClick={() => onIncludeCompletedChange(!includeCompleted)}
          >
            Closed
          </button>
          {searchOpen ? (
            <div className="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 px-2">
              <Search size={13} className="text-fg-muted" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search tasks…"
                className="w-36 bg-transparent py-1.5 text-xs text-fg outline-none"
              />
            </div>
          ) : (
            <button className="btn-ghost !p-2" title="Search" onClick={() => setSearchOpen(true)}>
              <Search size={15} />
            </button>
          )}
          <Dropdown align="right" width="w-52" trigger={
            <button className="btn-ghost !p-2" title="Customize">
              <Settings2 size={15} />
            </button>
          }>
            {settingsMenu}
          </Dropdown>
        </div>
      )}

      <div className={cn('min-h-0 flex-1 overflow-y-auto', embedded && 'h-full')}>
        {groups.length === 0 || filtered.length === 0 ? (
          <p className={cn('py-10 text-sm text-fg-muted', embedded ? 'px-4 text-center' : 'px-6')}>
            {emptyDescription}
          </p>
        ) : (
          <div className={cn('space-y-4', embedded ? 'px-3 py-2 pb-4' : 'space-y-6 px-6 py-4 pb-16')}>
            {groups.map((group) => (
              <TaskStatusGroup
                key={group.key}
                group={group}
                cols={DEFAULT_COLS}
                compact={embedded}
                alsoGroupByList={embedded && cardSettings.alsoGroupByList}
                projectNameById={projectNameById}
                taskTitleById={taskTitleById}
                wrapText={embedded && cardSettings.wrapText}
                showTaskLocations={embedded && cardSettings.showTaskLocations}
                showSubtaskParentNames={embedded && cardSettings.showSubtaskParentNames}
                onAddTask={onAddTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssignedEmbeddedTaskRow({
  task,
  showParent,
  parentTitle,
  showLocation,
  projectName,
  wrapText,
}: {
  task: Task
  showParent: boolean
  parentTitle?: string
  showLocation: boolean
  projectName?: string
  wrapText: boolean
}) {
  const navigate = useNavigate()

  return (
    <div
      data-task-id={task.id}
      className="grid cursor-pointer items-center gap-2 border-b border-ink-700/60 px-3 py-2 transition-colors last:border-b-0 hover:bg-ink-850"
      style={{ gridTemplateColumns: 'minmax(180px,1fr) 80px' }}
      onClick={() => {
        rememberOpenedTask(task.id)
        navigate(`/app/tasks/${task.id}`)
      }}
    >
      <div className="min-w-0">
        {showParent && parentTitle && (
          <div className={cn('text-[11px] text-fg-muted', wrapText ? '' : 'truncate')}>{parentTitle}</div>
        )}
        <div className={cn('text-sm text-fg', wrapText ? 'whitespace-normal break-words' : 'truncate')}>
          {task.title}
        </div>
        {showLocation && projectName && (
          <div className={cn('text-[11px] text-fg-muted', wrapText ? '' : 'truncate')}>{projectName}</div>
        )}
      </div>
      <div>
        <PriorityFlag priority={task.priority} withLabel />
      </div>
    </div>
  )
}

function TaskStatusGroup({
  group,
  cols,
  compact = false,
  alsoGroupByList = false,
  projectNameById,
  taskTitleById,
  wrapText = false,
  showTaskLocations = false,
  showSubtaskParentNames = false,
  onAddTask,
}: {
  group: StatusGroup
  cols: ColKey[]
  compact?: boolean
  alsoGroupByList?: boolean
  projectNameById?: Map<string, string>
  taskTitleById?: Map<string, string>
  wrapText?: boolean
  showTaskLocations?: boolean
  showSubtaskParentNames?: boolean
  onAddTask?: () => void
}) {
  const [open, setOpen] = useState(true)

  const listGroups = useMemo(() => {
    if (!alsoGroupByList || !projectNameById) return null
    const map = new Map<string, Task[]>()
    for (const task of group.tasks) {
      const pid = task.project_id ?? 'unknown'
      const list = map.get(pid) ?? []
      list.push(task)
      map.set(pid, list)
    }
    return [...map.entries()]
      .map(([projectId, tasks]) => ({
        projectId,
        projectName: projectNameById.get(projectId) ?? 'Unknown list',
        tasks,
      }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName))
  }, [alsoGroupByList, group.tasks, projectNameById])

  const renderTask = (task: Task) => {
    if (compact) {
      return (
        <AssignedEmbeddedTaskRow
          key={task.id}
          task={task}
          showParent={showSubtaskParentNames}
          parentTitle={task.parent_task_id ? taskTitleById?.get(task.parent_task_id) : undefined}
          showLocation={showTaskLocations}
          projectName={task.project_id ? projectNameById?.get(task.project_id) : undefined}
          wrapText={wrapText}
        />
      )
    }
    return <TaskRow key={task.id} task={task} canEdit cols={cols} />
  }

  const taskTable = (tasks: Task[]) => (
    <div className="overflow-hidden rounded-xl border border-ink-700">
      <div
        className={cn(
          'grid items-center gap-2 border-b border-ink-700 bg-ink-850 text-[11px] font-medium uppercase tracking-wide text-fg-muted',
          compact ? 'px-3 py-1.5' : 'px-4 py-2',
        )}
        style={{ gridTemplateColumns: compact ? 'minmax(180px,1fr) 80px' : `minmax(280px,1fr) 90px 110px 120px` }}
      >
        <span>Name</span>
        <span>Priority</span>
        {!compact && (
          <>
            <span>Due date</span>
            <span>Status</span>
          </>
        )}
      </div>
      {tasks.map((task) => renderTask(task))}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-muted transition-colors hover:bg-ink-850 hover:text-fg"
        onClick={() => onAddTask?.()}
      >
        + Add Task
      </button>
    </div>
  )

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="mb-1.5 flex items-center gap-2 py-1">
        {open ? <ChevronDown size={14} className="text-fg-muted" /> : <ChevronRight size={14} className="text-fg-muted" />}
        {group.pill}
        <span className="text-xs text-fg-muted">{group.tasks.length}</span>
      </button>
      {open &&
        (listGroups ? (
          <div className="space-y-3">
            {listGroups.map((lg) => (
              <div key={lg.projectId}>
                <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">{lg.projectName}</p>
                {taskTable(lg.tasks)}
              </div>
            ))}
          </div>
        ) : (
          taskTable(group.tasks)
        ))}
    </div>
  )
}

export function MyTasksBreadcrumbs({ leaf, favorite }: { leaf: string; favorite?: FavoriteTarget }) {
  return (
    <div className="flex items-center gap-2 border-b border-ink-700 px-6 py-3 text-sm">
      <span className="text-fg-muted">My Tasks</span>
      <span className="text-fg-muted">/</span>
      <span className="font-medium text-fg">{leaf}</span>
      {favorite && <FavoriteButton target={favorite} className="ml-1" />}
    </div>
  )
}
