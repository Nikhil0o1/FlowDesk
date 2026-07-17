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
  /** When false, backdrop click does not close (use for one-time secret dialogs). */
  closeOnBackdrop?: boolean
  /** When false, Escape does not close. */
  closeOnEscape?: boolean
  /** Hide the header close (X) button. */
  hideCloseButton?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
  closeOnBackdrop = true,
  closeOnEscape = true,
  hideCloseButton = false,
}: ModalProps) {
  useEffect(() => {
    if (!open || !closeOnEscape) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, closeOnEscape])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 pt-[10vh]"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div className={cn('flex max-h-[85vh] w-full flex-col rounded-2xl border border-ink-700 bg-ink-850 shadow-popover', width)}>
        {title && (
          <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-700 px-5 py-4">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-fg-muted hover:bg-ink-750 hover:text-fg"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
