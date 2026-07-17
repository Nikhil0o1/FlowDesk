import { useState } from 'react'
import { GitBranch, RotateCcw } from 'lucide-react'

import { timeAgo } from '../../../../lib/utils'
import { EmptyState } from '../../../../components/ui/EmptyState'
import { useVersionHistory } from '../../hooks/useVersionHistory'

/** Version history tab with restore + preview placeholder. */
export function VersionHistoryPanel({ documentId }: { documentId: string }) {
  const { versions, restore } = useVersionHistory(documentId)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const preview = versions.find((v) => v.id === previewId)

  if (versions.length === 0) {
    return <EmptyState icon={GitBranch} title="No versions yet" description="Each save creates a version you can restore." />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ul className="space-y-2">
          {versions.map((v) => (
            <li
              key={v.id}
              className="rounded-lg border border-ink-700 bg-ink-800/60 p-3 transition-colors hover:border-ink-600"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">
                    Version {v.versionNumber}
                    {v.versionNumber === versions[0]?.versionNumber && (
                      <span className="ml-2 text-[10px] font-normal text-brand">Latest</span>
                    )}
                  </p>
                  <p className="text-xs text-fg-secondary">{v.summary}</p>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    {v.authorName} · {timeAgo(v.createdAt)} · {v.wordCount} words
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-ink-750 hover:text-fg"
                    onClick={() => setPreviewId(v.id)}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-brand hover:bg-brand-soft"
                    onClick={() => restore(v.id)}
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {preview && (
        <div className="max-h-48 shrink-0 overflow-y-auto border-t border-ink-700 bg-ink-900 p-4">
          <p className="mb-2 text-xs font-semibold text-fg-muted">Preview · v{preview.versionNumber} (compare coming soon)</p>
          <div className="docs-content text-sm" dangerouslySetInnerHTML={{ __html: preview.content.slice(0, 2000) }} />
        </div>
      )}
    </div>
  )
}
