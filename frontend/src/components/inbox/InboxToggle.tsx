import { cn } from '../../lib/utils'

export function InboxToggle({
  checked,
  onChange,
  disabled,
  accent = 'brand',
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  accent?: 'brand' | 'amber'
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? (accent === 'amber' ? 'bg-[#c4a574]' : 'bg-brand') : 'bg-[#d1d5db]',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all',
          checked ? 'left-[14px]' : 'left-[2px]',
        )}
      />
    </button>
  )
}
