import { LayoutGrid, List as ListIcon } from 'lucide-react'

import { cn } from '../../../lib/utils'
import type { DocView } from '../types/editor'

export interface SelectOption {
  value: string
  label: string
}

/** Themed, accessible select used across the Docs toolbars. */
export function DocSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  ariaLabel: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-fg-secondary outline-none transition-colors hover:text-fg focus:border-brand"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Grid / list layout toggle. */
export function ViewToggle({ view, onChange }: { view: DocView; onChange: (v: DocView) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-ink-700 bg-ink-800 p-0.5">
      <ToggleButton active={view === 'grid'} onClick={() => onChange('grid')} label="Grid view">
        <LayoutGrid size={15} />
      </ToggleButton>
      <ToggleButton active={view === 'list'} onClick={() => onChange('list')} label="List view">
        <ListIcon size={15} />
      </ToggleButton>
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        active ? 'bg-brand-soft text-brand' : 'text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}
