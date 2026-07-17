import { useEffect, useRef, useState } from 'react'
import { Smile, X } from 'lucide-react'

import { EmojiPicker } from '../../../../components/chat/EmojiPicker'
import { cn } from '../../../../lib/utils'

interface PageIconPickerProps {
  icon?: string | null
  onChange: (icon: string | null) => void
  readOnly?: boolean
  /** @deprecated use variant */
  inline?: boolean
  variant?: 'default' | 'inline' | 'toolbar'
}

/** ClickUp-style page icon emoji picker. */
export function PageIconPicker({ icon, onChange, readOnly, inline, variant }: PageIconPickerProps) {
  const mode = variant ?? (inline ? 'inline' : 'default')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (readOnly && !icon && mode !== 'toolbar') return null

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => !readOnly && setOpen((v) => !v)}
        className={cn(
          'flex items-center justify-center rounded-lg transition-colors',
          mode === 'inline' && 'h-10 w-10 text-2xl hover:bg-ink-800',
          mode === 'toolbar' &&
            'gap-1.5 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-ink-800 hover:text-fg-secondary',
          mode === 'default' &&
            'gap-2 border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-sm hover:border-ink-600',
          readOnly && 'cursor-default opacity-70',
        )}
        aria-label={icon ? 'Change page icon' : 'Add page icon'}
      >
        {mode === 'toolbar' ? (
          <>
            <Smile size={14} className="shrink-0" />
            <span>{icon ? 'Change icon' : 'Add icon'}</span>
          </>
        ) : icon ? (
          <span className="leading-none">{icon}</span>
        ) : mode === 'inline' ? (
          <Smile size={18} className="text-fg-muted" />
        ) : (
          <>
            <Smile size={14} className="text-fg-muted" />
            <span className="text-fg-secondary">Add icon</span>
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-40 rounded-xl border border-ink-700 bg-ink-850 shadow-popover',
            mode === 'toolbar' ? 'left-0 top-full mt-1 w-72' : mode === 'inline' ? 'left-0 top-full mt-1' : 'right-0 top-full mt-1 w-72',
          )}
        >
          <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
            <span className="text-xs font-medium text-fg-muted">Page icon</span>
            <div className="flex items-center gap-2">
              {icon && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                  className="text-[11px] text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="text-fg-muted hover:text-fg">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            <EmojiPicker
              onPick={(emoji) => {
                onChange(emoji)
                setOpen(false)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
