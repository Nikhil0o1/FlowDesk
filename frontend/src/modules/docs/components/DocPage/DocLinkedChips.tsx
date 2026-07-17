import { ArrowUpRight, Link2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useDocumentLinks } from '../../hooks/useDocumentLinks'
import type { DocLink } from '../../types/docLink'

/** Linked task/doc chips shown below the page toolbar. */
export function DocLinkedChips({
  documentId,
  readOnly,
}: {
  documentId: string
  readOnly?: boolean
}) {
  const { links, removeLink } = useDocumentLinks(documentId)
  if (links.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {links.map((link) => (
        <LinkedChip key={link.id} link={link} onRemove={readOnly ? undefined : () => void removeLink(link.id)} />
      ))}
    </div>
  )
}

function LinkedChip({ link, onRemove }: { link: DocLink; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-fg-secondary">
      <Link2 size={11} className="text-fg-muted" />
      <Link to={link.href} className="flex items-center gap-1 hover:text-fg">
        {link.title}
        <ArrowUpRight size={11} />
      </Link>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 text-fg-muted hover:text-red-400" aria-label="Remove link">
          ×
        </button>
      )}
    </span>
  )
}
