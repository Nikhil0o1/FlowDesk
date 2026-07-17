import { Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Modal } from '../../../../components/ui/Modal'

interface InsertLinkDialogProps {
  open: boolean
  onClose: () => void
  defaultUrl?: string
  selectedText?: string
  onApply: (url: string) => void
}

/** In-app link dialog — replaces the browser prompt for doc hyperlinks. */
export function InsertLinkDialog({
  open,
  onClose,
  defaultUrl = '',
  selectedText,
  onApply,
}: InsertLinkDialogProps) {
  const [url, setUrl] = useState(defaultUrl)

  useEffect(() => {
    if (open) setUrl(defaultUrl)
  }, [open, defaultUrl])

  const submit = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    onApply(trimmed)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Insert link" width="max-w-md">
      <div className="space-y-4">
        {selectedText ? (
          <p className="text-sm text-fg-muted">
            Link text: <span className="font-medium text-fg">{selectedText}</span>
          </p>
        ) : (
          <p className="text-sm text-fg-muted">The URL will be inserted as link text.</p>
        )}

        <div>
          <label htmlFor="doc-link-url" className="mb-1.5 block text-xs font-medium text-fg-secondary">
            URL
          </label>
          <div className="relative">
            <Link2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              id="doc-link-url"
              autoFocus
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              className="input-dark w-full !py-2 !pl-9 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-ink-600 bg-ink-800 px-3.5 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!url.trim()}
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-50"
          >
            Apply link
          </button>
        </div>
      </div>
    </Modal>
  )
}
