import { cn } from '../../lib/utils'

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-5 w-5 animate-spin rounded-full border-2 border-ink-600 border-t-brand',
        className,
      )}
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-ink-950">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

export function CenteredSpinner() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  )
}
