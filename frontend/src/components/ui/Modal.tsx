import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  width?: string
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: ModalProps) {
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
      <div className={cn('w-full rounded-2xl border border-ink-700 bg-ink-850 shadow-popover', width)}>
        {title && (
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-1 text-fg-muted hover:bg-ink-750 hover:text-fg">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
