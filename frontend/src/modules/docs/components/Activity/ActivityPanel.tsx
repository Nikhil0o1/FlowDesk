import { History } from 'lucide-react'

import { timeAgo } from '../../../../lib/utils'
import { EmptyState } from '../../../../components/ui/EmptyState'
import { ACTIVITY_LABELS } from '../../services/activity.service'
import { useActivity } from '../../hooks/useActivity'

/** Activity timeline tab — newest first. */
export function ActivityPanel({ documentId }: { documentId: string }) {
  const { events } = useActivity(documentId)

  if (events.length === 0) {
    return <EmptyState icon={History} title="No activity yet" description="Edits, shares, and comments will show up here." />
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <ol className="relative space-y-4 border-l border-ink-700 pl-4">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink-850 bg-brand" aria-hidden />
            <p className="text-sm font-medium text-fg">{ACTIVITY_LABELS[e.type] ?? e.type}</p>
            <p className="text-xs text-fg-secondary">{e.detail}</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">
              {e.actorName} · {timeAgo(e.at)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
