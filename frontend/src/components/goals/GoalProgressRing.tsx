import { cn } from '../../lib/utils'

interface GoalProgressRingProps {
  progress: string | number
  size?: number
  strokeWidth?: number
  className?: string
}

export function goalProgressPercent(progress: string | number): number {
  const value = parseFloat(String(progress))
  if (Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function GoalProgressRing({
  progress,
  size = 88,
  strokeWidth,
  className,
  tone = 'default',
}: GoalProgressRingProps & { tone?: 'default' | 'onColor' }) {
  const pct = goalProgressPercent(progress)
  const stroke = strokeWidth ?? Math.max(5, Math.round(size / 14))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference
  const labelSize = size >= 90 ? 'text-base' : size >= 64 ? 'text-sm' : 'text-xs'
  const onColor = tone === 'onColor'

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className={onColor ? 'text-white/30' : 'text-ink-700'}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn('transition-all duration-500', onColor ? 'text-white' : 'text-brand')}
        />
      </svg>
      <span
        className={cn(
          'absolute font-semibold tabular-nums',
          labelSize,
          onColor ? 'text-white' : 'text-fg',
        )}
      >
        {pct}%
      </span>
    </div>
  )
}
