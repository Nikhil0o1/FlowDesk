import { SmilePlus } from 'lucide-react'
import { useState } from 'react'

import { cn } from '../../lib/utils'
import { Modal } from '../ui/Modal'

const SECTION_EMOJIS = ['⭐', '📁', '🎯', '🚀', '💼', '📣', '🛠️', '✨']

export function CreateFavoriteSectionModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string, emoji: string | null) => void
}) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const reset = () => {
    setName('')
    setEmoji(null)
    setPickerOpen(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed, emoji)
    reset()
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Create Section" width="max-w-md">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-ink-900 text-lg transition-colors',
              pickerOpen ? 'border-brand/50 bg-brand-soft/30' : 'border-ink-600 hover:border-ink-500',
            )}
            title="Pick icon"
            onClick={() => setPickerOpen((v) => !v)}
          >
            {emoji ? <span className="leading-none">{emoji}</span> : <SmilePlus size={18} className="text-fg-muted" />}
          </button>
          <input
            autoFocus
            className="input-dark min-w-0 flex-1"
            placeholder="E.g. Product, Marketing, Sales"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        {pickerOpen && (
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-3">
            <p className="mb-2 text-xs font-medium text-fg-muted">Pick an icon</p>
            <div className="grid grid-cols-8 gap-1">
              {SECTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors hover:bg-ink-750',
                    emoji === e && 'bg-brand-soft ring-1 ring-brand/40',
                  )}
                  onClick={() => {
                    setEmoji(e)
                    setPickerOpen(false)
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="btn-primary w-full" disabled={!name.trim()} onClick={submit}>
          Create
        </button>
      </div>
    </Modal>
  )
}
