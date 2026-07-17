import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ListTodo, Plus, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { useSprints } from '../../lib/queries'
import type { GoalTaskLink, Sprint, UserBrief } from '../../lib/types'
import { cn } from '../../lib/utils'
import { useAllTasks } from '../../services/tasks.service'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'
import { CenteredSpinner } from '../ui/Spinner'

function invalidateGoalProgress(
  queryClient: ReturnType<typeof useQueryClient>,
  {
    goalId,
    targetId,
    workspaceId,
  }: {
    goalId: string
    targetId: string
    workspaceId: string
  },
) {
  void queryClient.invalidateQueries({ queryKey: ['goal', goalId] })
  void queryClient.invalidateQueries({ queryKey: ['goal-progress', goalId] })
  void queryClient.invalidateQueries({ queryKey: ['goal-target-tasks', targetId] })
  void queryClient.invalidateQueries({ queryKey: ['goal-target-sprints', targetId] })
  void queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] })
  void queryClient.invalidateQueries({ queryKey: ['goal-folders', workspaceId] })
  void queryClient.invalidateQueries({ queryKey: ['goal-folder'] })
  void queryClient.invalidateQueries({ queryKey: ['folder-goals'] })
  void queryClient.invalidateQueries({ queryKey: ['goal-task-links', workspaceId] })
  void queryClient.invalidateQueries({ queryKey: ['goal-activity', goalId] })
}

type Panel = 'home' | 'tasks' | 'sprints'

interface AddToTargetModalProps {
  open: boolean
  onClose: () => void
  targetId: string
  goalId: string
  workspaceId: string
  targetOwner: UserBrief | null
}

export function AddToTargetModal({
  open,
  onClose,
  targetId,
  goalId,
  workspaceId,
  targetOwner,
}: AddToTargetModalProps) {
  const [panel, setPanel] = useState<Panel>('home')
  const [query, setQuery] = useState('')
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [selectedSprints, setSelectedSprints] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()
  const { data: tasks, isLoading: tasksLoading } = useAllTasks()
  const sprints = useSprints(open ? workspaceId : undefined)

  const links = useQuery({
    queryKey: ['goal-task-links', workspaceId],
    queryFn: () => api.get<GoalTaskLink[]>(`/workspaces/${workspaceId}/goal-task-links`),
    enabled: open && !!workspaceId,
  })

  const linkedSprints = useQuery({
    queryKey: ['goal-target-sprints', targetId],
    queryFn: () =>
      api.get<{ sprint_id: string; name: string; status: string; task_count: number }[]>(
        `/targets/${targetId}/sprints`,
      ),
    enabled: open && !!targetId,
  })

  const linkByTaskId = useMemo(() => {
    const map = new Map<string, GoalTaskLink>()
    for (const link of links.data ?? []) map.set(link.task_id, link)
    return map
  }, [links.data])

  const linkedSprintIds = useMemo(
    () => new Set((linkedSprints.data ?? []).map((s) => s.sprint_id)),
    [linkedSprints.data],
  )

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (tasks ?? []).filter((task) => {
      if (!q) return true
      return (
        task.title.toLowerCase().includes(q) ||
        task.ref.toLowerCase().includes(q) ||
        task.projectName.toLowerCase().includes(q)
      )
    })
  }, [tasks, query])

  const filteredSprints = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (sprints.data ?? []).filter((sprint) => {
      if (linkedSprintIds.has(sprint.id)) return false
      if (!q) return true
      return sprint.name.toLowerCase().includes(q) || sprint.status.toLowerCase().includes(q)
    })
  }, [sprints.data, query, linkedSprintIds])

  const saveMutation = useMutation({
    mutationFn: async () => {
      let taskCount = 0
      let sprintCount = 0
      if (selectedTasks.size) {
        await api.post(`/targets/${targetId}/tasks`, { task_ids: [...selectedTasks] })
        taskCount = selectedTasks.size
      }
      for (const sprintId of selectedSprints) {
        await api.post(`/targets/${targetId}/sprints`, { sprint_id: sprintId })
        sprintCount += 1
      }
      return { taskCount, sprintCount }
    },
    onSuccess: ({ taskCount, sprintCount }) => {
      invalidateGoalProgress(queryClient, { goalId, targetId, workspaceId })
      const parts: string[] = []
      if (taskCount) parts.push(`${taskCount} task${taskCount === 1 ? '' : 's'}`)
      if (sprintCount) parts.push(`${sprintCount} sprint${sprintCount === 1 ? '' : 's'}`)
      toast.success(parts.length ? `Linked ${parts.join(' · ')}` : 'Nothing to save')
      resetAndClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const resetAndClose = () => {
    setPanel('home')
    setQuery('')
    setSelectedTasks(new Set())
    setSelectedSprints(new Set())
    onClose()
  }

  const toggleTask = (taskId: string) => {
    const existing = linkByTaskId.get(taskId)
    if (existing) return
    setSelectedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const toggleSprint = (sprintId: string) => {
    setSelectedSprints((prev) => {
      const next = new Set(prev)
      if (next.has(sprintId)) next.delete(sprintId)
      else next.add(sprintId)
      return next
    })
  }

  const pendingCount = selectedTasks.size + selectedSprints.size
  const ownerName = targetOwner?.full_name || targetOwner?.email || 'Unassigned'

  return (
    <Modal open={open} onClose={resetAndClose} width="max-w-lg">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar
              name={ownerName}
              src={targetOwner?.avatar_url}
              color={targetOwner?.avatar_color}
              size={36}
            />
            <span className="truncate text-sm font-medium text-fg">{ownerName}</span>
          </div>
          <button type="button" className="btn-ghost !p-1.5" onClick={resetAndClose} title="Close">
            <X size={16} />
          </button>
        </div>

        {panel === 'home' && (
          <>
            <p className="text-sm text-fg">Add tasks or sprints to your target</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-600 bg-transparent px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-850"
                onClick={() => {
                  setQuery('')
                  setPanel('tasks')
                }}
              >
                <Plus size={14} />
                Add task
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-600 bg-transparent px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-850"
                onClick={() => {
                  setQuery('')
                  setPanel('sprints')
                }}
              >
                <Plus size={14} />
                Add sprint
              </button>
            </div>

            {(selectedTasks.size > 0 || selectedSprints.size > 0) && (
              <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-900/60 p-3">
                {selectedTasks.size > 0 && (
                  <p className="text-xs text-fg-muted">
                    {selectedTasks.size} task{selectedTasks.size === 1 ? '' : 's'} selected
                  </p>
                )}
                {selectedSprints.size > 0 && (
                  <div className="space-y-1">
                    {(sprints.data ?? [])
                      .filter((s) => selectedSprints.has(s.id))
                      .map((sprint) => (
                        <div
                          key={sprint.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-ink-850 px-2.5 py-1.5 text-sm"
                        >
                          <span className="truncate text-fg">{sprint.name}</span>
                          <button
                            type="button"
                            className="text-fg-muted hover:text-fg"
                            onClick={() => toggleSprint(sprint.id)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="flex w-full items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-semibold text-ink-950 hover:opacity-90 disabled:opacity-40"
              disabled={!pendingCount || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        )}

        {panel === 'tasks' && (
          <TaskPickerPanel
            query={query}
            onQueryChange={setQuery}
            loading={tasksLoading || links.isLoading}
            tasks={filteredTasks}
            linkByTaskId={linkByTaskId}
            selected={selectedTasks}
            targetId={targetId}
            onToggle={toggleTask}
            onBack={() => setPanel('home')}
            onDone={() => setPanel('home')}
          />
        )}

        {panel === 'sprints' && (
          <SprintPickerPanel
            query={query}
            onQueryChange={setQuery}
            loading={sprints.isLoading || linkedSprints.isLoading}
            sprints={filteredSprints}
            selected={selectedSprints}
            onToggle={toggleSprint}
            onBack={() => setPanel('home')}
            onDone={() => setPanel('home')}
          />
        )}
      </div>
    </Modal>
  )
}

function TaskPickerPanel({
  query,
  onQueryChange,
  loading,
  tasks,
  linkByTaskId,
  selected,
  targetId,
  onToggle,
  onBack,
  onDone,
}: {
  query: string
  onQueryChange: (v: string) => void
  loading: boolean
  tasks: NonNullable<Awaited<ReturnType<typeof useAllTasks>>['data']> | undefined
  linkByTaskId: Map<string, GoalTaskLink>
  selected: Set<string>
  targetId: string
  onToggle: (id: string) => void
  onBack: () => void
  onDone: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-sm text-fg-muted hover:text-fg" onClick={onBack}>
          ← Back
        </button>
        <h3 className="text-sm font-semibold text-fg">Add tasks</h3>
        <button
          type="button"
          className="text-sm font-medium text-brand hover:underline"
          onClick={onDone}
        >
          Done
        </button>
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          className="input w-full pl-9"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
        />
      </div>
      {loading ? (
        <CenteredSpinner />
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {(tasks ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-fg-muted">No tasks found</p>
          )}
          {(tasks ?? []).map((task) => {
            const existing = linkByTaskId.get(task.id)
            const linkedHere = existing?.target_id === targetId
            const linkedElsewhere = !!existing && !linkedHere
            const checked = selected.has(task.id) || linkedHere
            const disabled = linkedHere || linkedElsewhere
            return (
              <button
                key={task.id}
                type="button"
                disabled={disabled}
                onClick={() => onToggle(task.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
                  linkedElsewhere && 'cursor-not-allowed opacity-50',
                  linkedHere && 'cursor-default border-ink-700 bg-ink-850',
                  !disabled && checked && 'border-brand bg-brand-soft',
                  !disabled && !checked && 'border-ink-700 hover:bg-ink-850',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border',
                    checked ? 'border-brand bg-brand text-white' : 'border-ink-600',
                  )}
                >
                  {checked && <Check size={10} strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    <span className="text-fg-muted">{task.ref}</span> {task.title}
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    {task.projectName}
                    {linkedHere && ' · Already linked'}
                    {linkedElsewhere && ` · In “${existing.goal_name}”`}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SprintPickerPanel({
  query,
  onQueryChange,
  loading,
  sprints,
  selected,
  onToggle,
  onBack,
  onDone,
}: {
  query: string
  onQueryChange: (v: string) => void
  loading: boolean
  sprints: Sprint[]
  selected: Set<string>
  onToggle: (id: string) => void
  onBack: () => void
  onDone: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-sm text-fg-muted hover:text-fg" onClick={onBack}>
          ← Back
        </button>
        <h3 className="text-sm font-semibold text-fg">Add sprint</h3>
        <button
          type="button"
          className="text-sm font-medium text-brand hover:underline"
          onClick={onDone}
        >
          Done
        </button>
      </div>
      <p className="text-xs text-fg-muted">Choose a sprint. Its tasks will update this target’s progress.</p>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input
          className="input w-full pl-9"
          placeholder="Search sprints…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
        />
      </div>
      {loading ? (
        <CenteredSpinner />
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {sprints.length === 0 && (
            <p className="py-8 text-center text-sm text-fg-muted">No available sprints</p>
          )}
          {sprints.map((sprint) => {
            const checked = selected.has(sprint.id)
            return (
              <button
                key={sprint.id}
                type="button"
                onClick={() => onToggle(sprint.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
                  checked ? 'border-brand bg-brand-soft' : 'border-ink-700 hover:bg-ink-850',
                )}
              >
                <ListTodo size={16} className="shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{sprint.name}</p>
                  <p className="truncate text-xs capitalize text-fg-muted">
                    {sprint.status}
                    {sprint.task_count != null ? ` · ${sprint.task_count} tasks` : ''}
                  </p>
                </div>
                {checked && <Check size={16} className="text-brand" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
