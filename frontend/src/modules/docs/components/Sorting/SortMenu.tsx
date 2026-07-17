import { useState } from 'react'
import { ArrowDown, ArrowUp, Check } from 'lucide-react'

import { cn } from '../../../../lib/utils'
import { useDocsUIStore } from '../../stores/docsUIStore'
import type { DocSort } from '../../types/editor'

const SORT_OPTIONS: { value: DocSort; label: string }[] = [
  { value: 'created', label: 'Date created' },
  { value: 'updated', label: 'Date updated' },
  { value: 'viewed', label: 'Date viewed' },
]

/** ClickUp-style sort dropdown (date fields only). */
export function SortMenu() {
  const sort = useDocsUIStore((s) => s.sort)
  const sortDir = useDocsUIStore((s) => s.sortDir)
  const setSort = useDocsUIStore((s) => s.setSort)
  const setSortDir = useDocsUIStore((s) => s.setSortDir)
  const [open, setOpen] = useState(false)

  const active = SORT_OPTIONS.find((o) => o.value === sort)
  const DirIcon = sortDir === 'desc' ? ArrowDown : ArrowUp

  const pick = (value: DocSort) => {
    if (value === sort) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSort(value)
      setSortDir('desc')
    }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
          'border-brand/40 bg-brand-soft text-fg',
        )}
      >
        <DirIcon size={14} className="text-brand" />
        Sort: {active?.label ?? 'Date updated'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-10 z-50 w-48 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-xl">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => pick(opt.value)}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-ink-750',
                  sort === opt.value ? 'font-semibold text-fg' : 'text-fg-secondary',
                )}
              >
                <span>{opt.label}</span>
                {sort === opt.value && (
                  <span className="flex items-center gap-0.5 text-brand">
                    <Check size={14} />
                    {sortDir === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
