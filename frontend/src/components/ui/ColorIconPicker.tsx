import { Ban, Check } from 'lucide-react'

import { ENTITY_ICONS, ENTITY_ICON_KEYS } from '../../lib/entityIcons'
import { cn } from '../../lib/utils'

/** Preset palette for Space/Project color. */
export const ENTITY_COLORS = [
  '#4F8BFF',
  '#2B88EE',
  '#07BEA3',
  '#4CB782',
  '#7BCB3F',
  '#E8B500',
  '#F59E0B',
  '#FF7847',
  '#F0506E',
  '#EC4899',
  '#9B59B6',
  '#7C5CFC',
  '#5B6BFF',
  '#64748B',
  '#94A3B8',
  '#0EA5E9',
]

/**
 * Color + icon picker used as a flyout panel from the row context menu.
 * Calls `onPick` immediately on each choice (the caller persists optimistically).
 */
export function ColorIconPicker({
  color,
  icon,
  onPick,
}: {
  color: string
  icon: string | null
  onPick: (changes: { color?: string; icon?: string | null }) => void
}) {
  return (
    <div className="w-60 p-1">
      <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Color</p>
      <div className="grid grid-cols-8 gap-1 px-1 pb-2">
        {ENTITY_COLORS.map((c) => {
          const active = c.toLowerCase() === color?.toLowerCase()
          return (
            <button
              key={c}
              title={c}
              onClick={(e) => {
                e.stopPropagation()
                onPick({ color: c })
              }}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-md transition-transform hover:scale-110',
                active && 'ring-2 ring-white ring-offset-1 ring-offset-ink-850',
              )}
              style={{ backgroundColor: c }}
            >
              {active && <Check size={13} className="text-white" strokeWidth={3} />}
            </button>
          )
        })}
      </div>
      <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Icon</p>
      <div className="grid grid-cols-8 gap-1 px-1 pb-1">
        <button
          title="No icon"
          onClick={(e) => {
            e.stopPropagation()
            onPick({ icon: null })
          }}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg',
            !icon && 'bg-ink-750 text-fg ring-1 ring-ink-600',
          )}
        >
          <Ban size={14} />
        </button>
        {ENTITY_ICON_KEYS.map((key) => {
          const Icon = ENTITY_ICONS[key]
          const active = key === icon
          return (
            <button
              key={key}
              title={key}
              onClick={(e) => {
                e.stopPropagation()
                onPick({ icon: key })
              }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-ink-750',
                active ? 'bg-ink-750 ring-1 ring-ink-600' : 'text-fg-secondary hover:text-fg',
              )}
              style={active ? { color } : undefined}
            >
              <Icon size={14} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
