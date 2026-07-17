import { useEffect, useState } from 'react'

import { Modal } from './Modal'

export function RenameModal({
  open,
  onClose,
  title,
  label,
  initialName,
  onSave,
  saving,
}: {
  open: boolean
  onClose: () => void
  title: string
  label: string
  initialName: string
  onSave: (name: string) => Promise<void>
  saving?: boolean
}) {
  const [name, setName] = useState(initialName)

  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === initialName.trim()) {
      onClose()
      return
    }
    await onSave(trimmed)
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md">
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
          <input
            className="input-dark"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!name.trim() || saving} onClick={() => void submit()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
