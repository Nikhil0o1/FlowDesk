import { ArrowUpRight, Link2, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useDocumentLinks } from '../../hooks/useDocumentLinks'
import { LinkTaskOrDocPicker } from './LinkTaskOrDocPicker'

interface DocLinksPanelProps {
  documentId: string
  readOnly?: boolean
}

/** Sidebar panel listing linked tasks and documents. */
export function DocLinksPanel({ documentId, readOnly }: DocLinksPanelProps) {
  const { links, isLoading, removeLink } = useDocumentLinks(documentId)

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2">
        <Link2 size={16} className="text-fg-muted" />
        <h3 className="text-sm font-semibold text-fg">Relationships</h3>
      </div>

      <LinkTaskOrDocPicker documentId={documentId} readOnly={readOnly} showChips={false} />

      {isLoading ? (
        <div className="flex justify-center py-8 text-fg-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : links.length === 0 ? (
        <p className="mt-6 text-sm text-fg-muted">No linked tasks or documents yet.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {links.map((link) => (
            <li key={link.id}>
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-ink-800">
                <Link to={link.href} className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg-secondary hover:text-fg">
                  <span className="truncate">{link.title}</span>
                  <ArrowUpRight size={12} className="shrink-0" />
                </Link>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => void removeLink(link.id)}
                    className="shrink-0 text-xs text-fg-muted hover:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </div>
              {link.subtitle && <p className="px-2 pb-1 text-[11px] text-fg-muted">{link.subtitle}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
