import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect } from 'react'

import { ThemeSettings } from './ThemeSettings'

interface Props {
  open: boolean
  onClose: () => void
}

/** Appearance + accent dialog opened from the Topbar profile menu. The actual
 * controls live in `ThemeSettings`, shared with the Customize Sidebar → Themes tab. */
export function CustomizeModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-850 shadow-popover">
        <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Customize</h2>
            <p className="mt-0.5 text-xs text-fg-muted">Personalize your FlowDesk interface</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-fg-muted hover:bg-ink-750 hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <ThemeSettings />
        </div>
      </div>
    </div>,
    document.body,
  )
}
