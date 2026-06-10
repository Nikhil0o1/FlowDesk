import type { LucideIcon } from 'lucide-react'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-800">
        <Icon size={22} className="text-fg-muted" />
      </div>
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="max-w-sm text-sm text-fg-secondary">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
