import { cn } from '../../../../lib/utils'

/** Renders `text` with every case-insensitive occurrence of `query` highlighted. */
export function HighlightText({ text, query, className }: { text: string; query?: string; className?: string }) {
  const q = query?.trim()
  if (!q) return <span className={className}>{text}</span>

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))

  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className={cn('rounded-[3px] bg-brand/25 px-0.5 text-fg')}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </span>
  )
}
