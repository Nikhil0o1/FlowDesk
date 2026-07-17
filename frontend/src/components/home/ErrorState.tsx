import { AlertTriangle } from 'lucide-react'

interface Props {
  title?: string
  description?: string
  onRetry?: () => void
}

/** Standard error placeholder for the Home shortcut pages. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We couldn’t load this content. Please try again in a moment.',
  onRetry,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center" role="alert">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
        <AlertTriangle size={22} className="text-red-400" />
      </div>
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      <p className="max-w-sm text-sm text-fg-secondary">{description}</p>
      {onRetry && (
        <button className="btn-secondary mt-3" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
