import { useEffect, useRef, useState } from 'react'
import { Clock, Search, X } from 'lucide-react'

import { cn } from '../../../../lib/utils'

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  /** When provided, a dropdown of recent searches appears on focus. */
  recentSearches?: string[]
  onSubmitSearch?: (value: string) => void
  onClearRecent?: () => void
}

/**
 * Reusable, debounce-friendly search input. Optionally shows a recent-searches
 * dropdown (used by the global sidebar search).
 */
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search',
  ariaLabel = 'Search',
  className,
  recentSearches,
  onSubmitSearch,
  onClearRecent,
}: SearchBoxProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const showRecent = open && !!recentSearches && recentSearches.length > 0 && !value

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onSubmitSearch?.(value)
            setOpen(false)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="input-dark py-1.5 pl-8 pr-8 text-sm"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-muted hover:text-fg"
        >
          <X size={13} />
        </button>
      )}

      {showRecent && (
        <div className="menu-panel absolute left-0 right-0 top-full z-30 mt-1">
          <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Recent searches</span>
            {onClearRecent && (
              <button
                type="button"
                onClick={onClearRecent}
                className="text-[11px] text-fg-muted hover:text-fg"
              >
                Clear
              </button>
            )}
          </div>
          {recentSearches!.map((q) => (
            <button
              key={q}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(q)
                onSubmitSearch?.(q)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
            >
              <Clock size={13} className="shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate">{q}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
