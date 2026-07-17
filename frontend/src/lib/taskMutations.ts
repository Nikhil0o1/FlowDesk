import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from '../stores/toast'
import { api, errorMessage } from './api'
import {
  cancelTaskCaches,
  invalidateTaskCaches,
  patchTaskInCaches,
  restoreTaskCaches,
  snapshotTaskCaches,
} from './taskCache'
import type { CustomStatus, Priority, Task, UserBrief } from './types'

export interface TaskPatchVars {
  taskId: string
  body: Record<string, unknown>
  /** Optimistic transform applied to the cached task before the request. */
  apply?: (task: Task) => Task
}

/**
 * Optimistic task PATCH used everywhere a task field changes (status, priority,
 * due date, title, archive, …). The cache is updated instantly so the UI reacts
 * with zero latency; the request reconciles in the background and rolls back on
 * error.
 */
export function useTaskPatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, body }: TaskPatchVars) => api.patch<Task>(`/tasks/${taskId}`, body),
    onMutate: async ({ taskId, apply }: TaskPatchVars) => {
      if (!apply) return {}
      await cancelTaskCaches(qc)
      const snapshot = snapshotTaskCaches(qc)
      patchTaskInCaches(qc, taskId, apply)
      return { snapshot }
    },
    onError: (err, _vars, ctx: any) => {
      if (ctx?.snapshot) restoreTaskCaches(qc, ctx.snapshot)
      toast.error(errorMessage(err))
    },
    onSettled: (_d, _e, vars) => invalidateTaskCaches(qc, vars.taskId),
  })
}

// ---- field-apply helpers (pure transforms for the `apply` option) ----

/** Set status optimistically, mirroring the server's completed_at behaviour. */
export function withStatus(status: CustomStatus | null) {
  return (t: Task): Task => ({
    ...t,
    status,
    completed_at:
      status?.category === 'done' ? (t.completed_at ?? new Date().toISOString()) : null,
  })
}

export function withPriority(priority: Priority | null) {
  return (t: Task): Task => ({ ...t, priority })
}

export function withDueDate(due: string | null) {
  return (t: Task): Task => ({ ...t, due_date: due })
}

export function withStartDate(start: string | null) {
  return (t: Task): Task => ({ ...t, start_date: start })
}

export function withAssignees(assignees: UserBrief[]) {
  return (t: Task): Task => ({ ...t, assignees })
}
