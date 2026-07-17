import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { createPortal } from 'react-dom'

import { cn } from '../../../../lib/utils'
import { useDocsUIStore } from '../../stores/docsUIStore'
import { DOC_TABLE_COLUMNS } from '../../types/editor'

const PANEL_WIDTH = 196
const PANEL_GAP = 8

function ColumnToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onChange(!checked)
      }}
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-brand' : 'bg-ink-700',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
          checked ? 'left-[14px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

/** ClickUp-style "+" column picker for the Docs table header. */
export function ColumnsMenu() {
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const visibleColumns = useDocsUIStore((s) => s.visibleColumns)
  const setColumnVisible = useDocsUIStore((s) => s.setColumnVisible)

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPanelPos({
      top: rect.top - PANEL_GAP,
      left: Math.max(8, rect.right - PANEL_WIDTH),
    })
    setOpen(true)
  }

  // Open upward above the "+" trigger so the menu does not cover table rows.
  useLayoutEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    const panel = panelRef.current
    if (!rect || !panel) return
    const height = panel.offsetHeight
    const left = Math.max(8, rect.right - PANEL_WIDTH)
    const top = Math.max(8, rect.top - height - PANEL_GAP)
    setPanelPos({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Columns"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          if (open) setOpen(false)
          else openPanel()
        }}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full border border-ink-600 text-fg-muted transition-colors',
          'hover:border-ink-500 hover:bg-ink-750 hover:text-fg',
          open && 'border-brand/50 bg-brand-soft text-brand',
        )}
      >
        <Plus size={14} />
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <div
              ref={panelRef}
              className="fixed z-50 overflow-hidden rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-xl"
              style={{ top: panelPos.top, left: panelPos.left, width: PANEL_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Columns
              </p>
              <ul className="max-h-52 overflow-y-auto">
                {DOC_TABLE_COLUMNS.map((col) => {
                  const checked = visibleColumns.includes(col.id)
                  const locked = Boolean(col.locked)
                  return (
                    <li key={col.id}>
                      <div
                        className={cn(
                          'flex items-center justify-between gap-2 px-2.5 py-1',
                          locked ? 'opacity-70' : 'hover:bg-ink-750',
                        )}
                      >
                        <span className={cn('text-xs', locked ? 'text-fg-muted' : 'text-fg')}>
                          {col.label}
                        </span>
                        <ColumnToggle
                          checked={checked}
                          disabled={locked}
                          onChange={(v) => setColumnVisible(col.id, v)}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
