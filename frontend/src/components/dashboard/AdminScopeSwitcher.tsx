import { ChevronDown } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Dropdown } from '../ui/Dropdown'

export interface ScopeOption {
  id: string
  label: string
  meta?: string
}

export function AdminScopeSwitcher({
  options,
  value,
  onChange,
  className,
  menuHeading = 'Your admin scopes',
}: {
  options: ScopeOption[]
  value: string
  onChange: (id: string) => void
  className?: string
  menuHeading?: string
}) {
  if (options.length <= 1) return null

  const current = options.find((o) => o.id === value) ?? options[0]

  return (
    <Dropdown
      align="left"
      width="w-72"
      trigger={
        <button
          type="button"
          className={cn(
            'flex max-w-full items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800/60 px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:border-ink-600 hover:text-fg',
            className,
          )}
        >
          <span className="min-w-0 truncate">{current.label}</span>
          <span className="shrink-0 rounded bg-ink-750 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted">
            {options.length}
          </span>
          <ChevronDown size={12} className="shrink-0 text-fg-muted" />
        </button>
      }
    >
      {(close) => (
        <>
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            {menuHeading}
          </p>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={cn('menu-item !items-start', opt.id === value && 'bg-ink-750')}
              onClick={() => {
                onChange(opt.id)
                close()
              }}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">{opt.label}</span>
              {opt.meta && (
                <span className="max-w-[140px] truncate text-[10px] text-fg-muted">{opt.meta}</span>
              )}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  )
}
