import { combineDurationParts, splitDurationParts, type DurationParts } from '../../lib/utils'

/** Compact d / h / m / s inputs. Returns total seconds via onChange. */
export function DurationPartsInputs({
  valueSeconds,
  onChange,
  className,
  inputClassName = 'input-dark !w-12 !py-1 text-center text-sm',
}: {
  valueSeconds: number
  onChange: (totalSeconds: number) => void
  className?: string
  inputClassName?: string
}) {
  const parts = splitDurationParts(valueSeconds)

  const setPart = (key: keyof DurationParts, raw: string) => {
    const next = { ...parts, [key]: Math.max(0, Number(raw.replace(/\D/g, '')) || 0) }
    onChange(combineDurationParts(next))
  }

  const field = (key: keyof DurationParts, label: string) => (
    <label className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        value={parts[key] || ''}
        placeholder="0"
        onChange={(e) => setPart(key, e.target.value)}
        className={inputClassName}
      />
      <span className="text-[11px] text-fg-muted">{label}</span>
    </label>
  )

  return (
    <div className={className ?? 'flex flex-wrap items-center gap-1.5'}>
      {field('days', 'd')}
      {field('hours', 'h')}
      {field('minutes', 'm')}
      {field('seconds', 's')}
    </div>
  )
}
