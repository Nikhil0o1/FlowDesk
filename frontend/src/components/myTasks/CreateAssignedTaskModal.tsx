import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { invalidateMyTasks } from '../../lib/myTasksQueries'
import { useCurrentContext, useProjects } from '../../lib/queries'
import type { Task } from '../../lib/types'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'

export function CreateAssignedTaskModal({
  open,
  onClose,
  defaultProjectId,
}: {
  open: boolean
  onClose: () => void
  defaultProjectId?: string
}) {
  const user = useAuthStore((s) => s.user)
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const queryClient = useQueryClient()

  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const effectiveProjectId = projectId || projects.data?.[0]?.id || ''

  const create = async () => {
    if (!effectiveProjectId || !title.trim()) return
    setSubmitting(true)
    try {
      const task = await api.post<Task>(`/projects/${effectiveProjectId}/tasks`, {
        title: title.trim(),
        description: description.trim() || undefined,
        assignee_ids: user ? [user.id] : [],
      })
      toast.success(`${task.ref} created`)
      invalidateMyTasks(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setTitle('')
      setDescription('')
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Modal open onClose={onClose} title="Task" width="max-w-lg">
      <div className="space-y-3">
        {(projects.data ?? []).length === 0 ? (
          <p className="text-sm text-fg-muted">You don&apos;t have access to any projects yet.</p>
        ) : (
          <>
            <select
              className="input-dark text-sm"
              value={effectiveProjectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              autoFocus
              className="input-dark text-base font-medium"
              placeholder="Task Name or type '/' for commands"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
            <textarea
              className="input-dark min-h-[72px] resize-none text-sm"
              placeholder="Add description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex justify-end border-t border-ink-700 pt-3">
              <button
                type="button"
                className="btn-primary"
                disabled={submitting || !title.trim()}
                onClick={() => void create()}
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? 'Creating…' : 'Create Task'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
