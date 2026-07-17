import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderInput } from 'lucide-react'
import { useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { Goal, GoalFolder } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'

interface MoveGoalToFolderModalProps {
  open: boolean
  onClose: () => void
  goal: Pick<Goal, 'id' | 'name' | 'folder_id'> | null
  workspaceId: string
  canCreateFolder?: boolean
  onMoved?: (goal: Goal) => void
}

export function MoveGoalToFolderModal({
  open,
  onClose,
  goal,
  workspaceId,
  canCreateFolder = true,
  onMoved,
}: MoveGoalToFolderModalProps) {
  const queryClient = useQueryClient()
  const [newFolderName, setNewFolderName] = useState('')

  const folders = useQuery({
    queryKey: ['goal-folders', workspaceId],
    queryFn: () => api.get<GoalFolder[]>(`/workspaces/${workspaceId}/goal-folders`),
    enabled: open && !!workspaceId,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['goal', goal?.id] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folders', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['goal-folder'] })
    void queryClient.invalidateQueries({ queryKey: ['folder-goals'] })
  }

  const move = useMutation({
    mutationFn: (folder_id: string | null) =>
      api.post<Goal>(`/goals/${goal!.id}/move`, { folder_id }),
    onSuccess: (updated, folder_id) => {
      invalidate()
      const label =
        folder_id == null
          ? 'Removed from folder'
          : `Moved to ${folders.data?.find((f) => f.id === folder_id)?.name ?? 'folder'}`
      toast.success(label)
      onMoved?.(updated)
      setNewFolderName('')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const createAndMove = useMutation({
    mutationFn: async (name: string) => {
      const folder = await api.post<GoalFolder>(`/workspaces/${workspaceId}/goal-folders`, { name })
      const updated = await api.post<Goal>(`/goals/${goal!.id}/move`, { folder_id: folder.id })
      return { folder, updated }
    },
    onSuccess: ({ folder, updated }) => {
      invalidate()
      toast.success(`Moved to ${folder.name}`)
      onMoved?.(updated)
      setNewFolderName('')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (!goal) return null

  return (
    <Modal open={open} onClose={onClose} title="Move to Folder">
      <div className="space-y-2">
        <p className="mb-3 text-sm text-fg-muted">
          Move <span className="font-medium text-fg">{goal.name}</span>
        </p>
        <button
          type="button"
          disabled={move.isPending}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-ink-800',
            !goal.folder_id && 'bg-ink-800',
          )}
          onClick={() => move.mutate(null)}
        >
          <FolderInput size={14} className="text-fg-muted" />
          No folder (unfiled)
        </button>
        {(folders.data ?? []).map((folder) => (
          <button
            key={folder.id}
            type="button"
            disabled={move.isPending}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-ink-800',
              goal.folder_id === folder.id && 'bg-ink-800',
            )}
            onClick={() => move.mutate(folder.id)}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: folder.color ?? '#64748b' }}
            />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="text-xs text-fg-muted">{folder.goal_count}</span>
          </button>
        ))}
        {(folders.data ?? []).length === 0 && (
          <p className="px-1 py-2 text-sm text-fg-muted">No folders yet.</p>
        )}
        {canCreateFolder && (
          <div className="flex gap-2 border-t border-ink-700 pt-3">
            <input
              className="input flex-1 !py-1.5 text-sm"
              placeholder="New folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) {
                  createAndMove.mutate(newFolderName.trim())
                }
              }}
            />
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 text-sm"
              disabled={!newFolderName.trim() || createAndMove.isPending}
              onClick={() => createAndMove.mutate(newFolderName.trim())}
            >
              Create
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
