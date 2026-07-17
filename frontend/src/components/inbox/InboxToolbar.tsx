import { CheckCheck, Filter, Settings2 } from 'lucide-react'
import { useRef } from 'react'

import type { InboxFilter, InboxSummary } from '../../lib/types'
import { cn } from '../../lib/utils'
import { InboxFilterMenu } from './InboxFilterMenu'

export function InboxToolbar({
  summary,
  activeFilter,
  onFilterChange,
  onOpenSettings,
  onClearAll,
  clearing,
  canClear,
  filterOpen,
  onFilterOpenChange,
}: {
  summary?: InboxSummary
  activeFilter: InboxFilter | null
  onFilterChange: (filter: InboxFilter | null) => void
  onOpenSettings: () => void
  onClearAll: () => void
  clearing?: boolean
  canClear: boolean
  filterOpen: boolean
  onFilterOpenChange: (open: boolean) => void
}) {
  const filterRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex items-center justify-between border-b border-[#e8eaed] bg-white px-4 py-2">
      <div className="relative" ref={filterRef}>
        <button
          onClick={() => onFilterOpenChange(!filterOpen)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors',
            activeFilter || filterOpen
              ? 'bg-[#f3f4f6] text-[#1a1d21]'
              : 'text-[#4b5563] hover:bg-[#f3f4f6]',
          )}
        >
          <Filter size={14} />
          Filter
        </button>
        {filterOpen && (
          <InboxFilterMenu
            summary={summary}
            active={activeFilter}
            onSelect={(f) => {
              onFilterChange(f)
              onFilterOpenChange(false)
            }}
            onClose={() => onFilterOpenChange(false)}
          />
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onOpenSettings}
          title="Customize Inbox"
          className="rounded-md p-1.5 text-[#6b7280] transition-colors hover:bg-[#f3f4f6] hover:text-[#1a1d21]"
        >
          <Settings2 size={15} />
        </button>
        <button
          disabled={!canClear || clearing}
          onClick={onClearAll}
          className={cn(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium transition-colors',
            canClear
              ? 'text-[#4b5563] hover:bg-[#f3f4f6]'
              : 'cursor-not-allowed text-[#c4c9d0]',
          )}
        >
          <CheckCheck size={14} />
          Clear all
        </button>
      </div>
    </div>
  )
}
