import { cn } from '../../../../lib/utils'
import { useDocsUIStore } from '../../stores/docsUIStore'
import type { FlowDoc } from '../../types/document'
import { distinctTags } from '../../services/docs.service'

interface TagsFilterProps {
  docs: FlowDoc[]
}

/** ClickUp-style "Tags:" chip row in the docs toolbar. */
export function TagsFilter({ docs }: TagsFilterProps) {
  const tagFilter = useDocsUIStore((s) => s.tagFilter)
  const toggleTagFilter = useDocsUIStore((s) => s.toggleTagFilter)
  const tags = distinctTags(docs)

  if (tags.length === 0) {
    return (
      <div className="flex items-center gap-2 border-l border-ink-700 pl-3">
        <span className="text-sm text-fg-muted">Tags:</span>
        <span className="text-sm text-fg-secondary">View all</span>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-ink-700 pl-3">
      <span className="shrink-0 text-sm text-fg-muted">Tags:</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {tags.map((tag) => {
          const active = tagFilter.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTagFilter(tag)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-brand-soft text-brand'
                  : 'bg-ink-800 text-fg-secondary hover:bg-ink-750 hover:text-fg',
              )}
            >
              {tag}
            </button>
          )
        })}
      </div>
    </div>
  )
}
