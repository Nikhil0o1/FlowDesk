import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { Channel } from '../../lib/types'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'

export function CreateChannelModal({
  open,
  onClose,
  workspaceId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  workspaceId: string | undefined
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) return
    setName('')
    setDescription('')
    setIsPrivate(false)
    setCreating(false)
  }, [open])

  const create = async () => {
    if (!workspaceId || !name.trim()) return
    setCreating(true)
    try {
      const channel = await api.post<Channel>(`/workspaces/${workspaceId}/channels`, {
        name: name.trim(),
        description: description.trim() || null,
        is_private: isPrivate,
      })
      queryClient.setQueryData<Channel[]>(['channels', workspaceId], (old) =>
        old ? (old.some((existing) => existing.id === channel.id) ? old : [...old, channel]) : [channel],
      )
      void queryClient.invalidateQueries({ queryKey: ['channels', workspaceId] })
      toast.success(`#${channel.name} created`)
      onClose()
      onCreated(channel.id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create channel" width="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Name</label>
          <input
            className="input-dark"
            placeholder="e.g. engineering"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !creating && name.trim() && void create()}
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Description (optional)</label>
          <input
            className="input-dark"
            placeholder="What's this channel about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !creating && name.trim() && void create()}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="accent-brand"
          />
          Private channel (invite only)
        </label>
        <button className="btn-primary w-full" disabled={creating || !name.trim()} onClick={() => void create()}>
          {creating ? 'Creating…' : 'Create channel'}
        </button>
      </div>
    </Modal>
  )
}
