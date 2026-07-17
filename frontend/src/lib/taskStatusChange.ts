import { askCompleteWithSubtasks } from '../stores/completeSubtasksConfirm'
import type { CustomStatus, Task } from './types'

type SubtaskAwareTask = Pick<Task, 'subtask_count' | 'subtask_done_count' | 'title'> & {
  subtasks?: Pick<Task, 'completed_at'>[]
}

/** Count of subtasks that are not completed. */
export function pendingSubtaskCount(task: SubtaskAwareTask): number {
  if (task.subtasks?.length) {
    return task.subtasks.filter((s) => !s.completed_at).length
  }
  return Math.max(0, (task.subtask_count ?? 0) - (task.subtask_done_count ?? 0))
}

/**
 * Build a status PATCH body, prompting when completing a parent with open subtasks.
 * Returns null when the user cancels the confirmation.
 */
export async function buildStatusUpdate(
  task: SubtaskAwareTask,
  status: CustomStatus,
): Promise<Record<string, unknown> | null> {
  if (status.category === 'done' && pendingSubtaskCount(task) > 0) {
    const ok = await askCompleteWithSubtasks({
      pendingCount: pendingSubtaskCount(task),
      taskTitle: task.title,
    })
    if (!ok) return null
    return { status_id: status.id, force_complete_subtasks: true }
  }
  return { status_id: status.id }
}
