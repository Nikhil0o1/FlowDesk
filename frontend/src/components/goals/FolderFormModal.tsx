import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import type { GoalFolder } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Modal } from '../ui/Modal'
import { FOLDER_COLORS } from './FolderCards'

interface FolderFormModalProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  folder?: GoalFolder | null
  onSaved: (folder: GoalFolder) => void
}

export function FolderFormModal({ open, onClose, workspaceId, folder, onSaved }: FolderFormModalProps) {
  const isEdit = !!folder
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string | null>(FOLDER_COLORS[0])
  const [isPrivate, setIsPrivate] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(folder?.name ?? '')
    setDescription(folder?.description ?? '')
    setColor(folder?.color ?? FOLDER_COLORS[0])
    setIsPrivate(folder?.is_private ?? false)
  }, [open, folder])

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Enter a folder name')
      return
    }
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        color,
        is_private: isPrivate,
      }
      const saved = isEdit
        ? await api.patch<GoalFolder>(`/goal-folders/${folder!.id}`, body)
        : await api.post<GoalFolder>(`/workspaces/${workspaceId}/goal-folders`, body)
      toast.success(isEdit ? 'Folder updated' : 'Folder created')
      onSaved(saved)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit folder' : 'Create folder'}>
      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-fg">Name</label>
          <input
            autoFocus
            className="input w-full"
            placeholder="e.g. Engineering OKRs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-fg">Description</label>
          <textarea
            className="input min-h-[80px] w-full resize-y"
            placeholder="Optional — what this folder groups"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-fg">Color</label>
          <div className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className={cn(
                  'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110',
                  color === c ? 'border-fg' : 'border-transparent',
                )}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 px-3 py-2.5">
          <span className="text-sm text-fg">Private folder</span>
          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            onClick={() => setIsPrivate((v) => !v)}
            className={cn(
              'relative h-6 w-11 rounded-full transition-colors',
              isPrivate ? 'bg-brand' : 'bg-ink-700',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                isPrivate ? 'left-5' : 'left-0.5',
              )}
            />
          </button>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost inline-flex items-center gap-1" onClick={onClose}>
            <X size={14} />
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-700 px-3 py-1.5 text-sm font-semibold text-fg hover:bg-ink-600 disabled:opacity-50"
            disabled={saving || !name.trim()}
            onClick={() => void submit()}
          >
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            {!saving && <Check size={14} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </Modal>
  )
}
