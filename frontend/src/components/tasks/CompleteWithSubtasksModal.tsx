import { AlertTriangle } from 'lucide-react'

import { useCompleteSubtasksConfirmStore } from '../../stores/completeSubtasksConfirm'
import { Modal } from '../ui/Modal'

/** App-wide confirmation when completing a parent task that still has open subtasks. */
export function CompleteWithSubtasksModal() {
  const open = useCompleteSubtasksConfirmStore((s) => s.open)
  const pendingCount = useCompleteSubtasksConfirmStore((s) => s.pendingCount)
  const taskTitle = useCompleteSubtasksConfirmStore((s) => s.taskTitle)
  const confirm = useCompleteSubtasksConfirmStore((s) => s.confirm)
  const cancel = useCompleteSubtasksConfirmStore((s) => s.cancel)

  const label = pendingCount === 1 ? '1 open subtask' : `${pendingCount} open subtasks`

  return (
    <Modal open={open} onClose={cancel} title="Complete task?" width="max-w-md">
      <div className="space-y-4">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
            <AlertTriangle size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-fg">
              {taskTitle ? (
                <>
                  <span className="font-medium">{taskTitle}</span> still has {label}.
                </>
              ) : (
                <>This task still has {label}.</>
              )}
            </p>
            <p className="mt-1.5 text-sm text-fg-muted">
              Completing it will also mark all remaining subtasks as done.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={cancel}
            className="rounded-lg border border-ink-600 bg-ink-800 px-3.5 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110"
          >
            Complete all
          </button>
        </div>
      </div>
    </Modal>
  )
}
