import { useId } from 'react'

import { cn } from '../../lib/utils'

interface Props {
  /** Rendered inside a fixed 20×20 slot, right of the checkbox. */
  icon: React.ReactNode
  label: string
  checked: boolean
  /** When true the checkbox is disabled (e.g. locked / last remaining item). */
  disabled?: boolean
  onChange: (checked: boolean) => void
}

/**
 * Reusable `[checkbox] icon label` row shared by every sidebar-customization
 * list (Navigation, Home, …). Uses a native checkbox tied to its label so it is
 * fully keyboard accessible (Tab to focus, Space to toggle).
 */
export function SidebarSettingRow({ icon, label, checked, disabled = false, onChange }: Props) {
  const id = useId()

  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-ink-750',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-ink-600 bg-ink-800 text-brand accent-brand focus:ring-2 focus:ring-brand focus:ring-offset-0 disabled:cursor-not-allowed"
      />
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 text-sm text-fg">{label}</span>
    </label>
  )
}
