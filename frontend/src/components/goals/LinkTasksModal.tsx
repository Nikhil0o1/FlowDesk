import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { GoalTaskLink } from '../../lib/types'
import { useAllTasks } from '../../services/tasks.service'
import { toast } from '../../stores/toast'
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
  void queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] })
  void queryClient.invalidateQueries({ queryKey: ['goal-folders', workspaceId] })
  void queryClient.invalidateQueries({ queryKey: ['goal-folder'] })
  void queryClient.invalidateQueries({ queryKey: ['folder-goals'] })
  void queryClient.invalidateQueries({ queryKey: ['goal-task-links', workspaceId] })
}

interface LinkTasksModalProps {
  open: boolean
  onClose: () => void
  targetId: string
  goalId: string
  workspaceId: string
}

export function LinkTasksModal({ open, onClose, targetId, goalId, workspaceId }: LinkTasksModalProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { data: tasks, isLoading } = useAllTasks()
  const queryClient = useQueryClient()

  const links = useQuery({
    queryKey: ['goal-task-links', workspaceId],
    queryFn: () => api.get<GoalTaskLink[]>(`/workspaces/${workspaceId}/goal-task-links`),
    enabled: open && !!workspaceId,
  })

  const linkByTaskId = useMemo(() => {
    const map = new Map<string, GoalTaskLink>()
    for (const link of links.data ?? []) {
      map.set(link.task_id, link)
    }
    return map
  }, [links.data])

  const filtered = useMemo(() => {
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

  const linkMutation = useMutation({
    mutationFn: (taskIds: string[]) =>
      api.post(`/targets/${targetId}/tasks`, { task_ids: taskIds }),
    onSuccess: () => {
      invalidateGoalProgress(queryClient, { goalId, targetId, workspaceId })
      toast.success('Tasks linked')
      setSelected(new Set())
      setQuery('')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const toggle = (taskId: string) => {
    const existing = linkByTaskId.get(taskId)
    if (existing && existing.target_id !== targetId) return
    if (existing && existing.target_id === targetId) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const handleLink = () => {
    if (!selected.size) {
      toast.error('Select at least one task')
      return
    }
    linkMutation.mutate([...selected])
  }

  return (
    <Modal open={open} onClose={onClose} title="Link existing tasks" width="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Progress for this target is completed tasks ÷ linked tasks. A task can belong to only one goal.
        </p>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            className="input w-full pl-9"
            placeholder="Search by title, ref, or project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {isLoading || links.isLoading ? (
          <CenteredSpinner />
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-fg-muted">No tasks found</p>
            )}
            {filtered.map((task) => {
              const isDone = task.status?.category === 'done'
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
                  onClick={() => toggle(task.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    linkedElsewhere
                      ? 'cursor-not-allowed border-ink-800 bg-ink-900/50 opacity-60'
                      : linkedHere
                        ? 'cursor-default border-ink-700 bg-ink-850'
                        : checked
                          ? 'border-brand bg-brand-soft'
                          : 'border-ink-700 bg-ink-900 hover:bg-ink-850'
                  }`}
                >
                  <input type="checkbox" readOnly checked={checked} disabled={disabled} className="accent-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      <span className="text-fg-muted">{task.ref}</span> {task.title}
                    </p>
                    <p className="truncate text-xs text-fg-muted">
                      {task.projectName}
                      {linkedHere && ' · Already linked'}
                      {linkedElsewhere && ` · In goal “${existing.goal_name}”`}
                    </p>
                  </div>
                  {isDone && (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
                      Done
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-ink-700 pt-4">
          <span className="text-sm text-fg-muted">{selected.size} selected</span>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!selected.size || linkMutation.isPending}
              onClick={handleLink}
            >
              {linkMutation.isPending ? 'Linking…' : 'Link tasks'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function UnlinkTaskButton({
  targetId,
  taskId,
  goalId,
  workspaceId,
}: {
  targetId: string
  taskId: string
  goalId: string
  workspaceId: string
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => api.delete(`/targets/${targetId}/tasks/${taskId}`),
    onSuccess: () => {
      invalidateGoalProgress(queryClient, { goalId, targetId, workspaceId })
      toast.success('Task unlinked')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <button
      type="button"
      className="rounded p-1 text-fg-muted hover:bg-ink-750 hover:text-fg"
      title="Unlink task"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      <X size={14} />
    </button>
  )
}
