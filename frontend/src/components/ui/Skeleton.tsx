import { cn } from '../../lib/utils'

/** Lightweight shimmer placeholder used while page data is loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-ink-800', className)} aria-hidden />
}
