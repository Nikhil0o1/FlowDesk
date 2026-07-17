import { Check, Copy, ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Modal } from '../ui/Modal'
import {
  copyPublicFormLink,
  publicFormEmbedCode,
  publicFormUrl,
  type EmbedOptions,
} from '../../lib/publicForms'
import { EXTERNAL_LINK_REL, safeHttpUrl } from '../../lib/safeUrl'
import { toast } from '../../stores/toast'

type FormSharePanelProps = {
  open: boolean
  onClose: () => void
  publicToken: string
  formName: string
  isActive: boolean
}

export function FormSharePanel({ open, onClose, publicToken, formName, isActive }: FormSharePanelProps) {
  const [autosize, setAutosize] = useState(false)
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null)

  const publicUrl = useMemo(() => publicFormUrl(publicToken), [publicToken])
  const embedCode = useMemo(
    () => publicFormEmbedCode(publicToken, { autosize } satisfies EmbedOptions),
    [publicToken, autosize],
  )

  const flashCopied = (which: 'link' | 'embed') => {
    setCopied(which)
    window.setTimeout(() => setCopied(null), 2000)
  }

  const copyLink = async () => {
    await copyPublicFormLink(publicToken)
    flashCopied('link')
    toast.success('Public link copied')
  }

  const copyEmbed = async () => {
    await navigator.clipboard.writeText(embedCode)
    flashCopied('embed')
    toast.success('Embed code copied')
  }

  return (
    <Modal open={open} onClose={onClose} title={`Share — ${formName}`} width="max-w-lg">
      <div className="space-y-5">
        <p className="text-sm text-fg-secondary">
          Share this link with project members. Each submission creates a task in your project.
        </p>

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-fg-muted">
            Public link
          </label>
          <div className="flex gap-2">
            <input
              readOnly
              value={publicUrl}
              className="input-dark min-w-0 flex-1 !text-xs"
              onFocus={(e) => e.target.select()}
            />
            <button className="btn-secondary shrink-0 !px-3" onClick={() => void copyLink()} title="Copy link">
              {copied === 'link' ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <a
              href={safeHttpUrl(publicUrl) ?? undefined}
              target="_blank"
              rel={EXTERNAL_LINK_REL}
              className="btn-secondary shrink-0 !px-3"
              title="Open in new tab"
            >
              <ExternalLink size={14} />
            </a>
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">
            {isActive ? 'Link is live — accepting submissions.' : 'Form is paused — link shows an unavailable message.'}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-fg-muted">
            Embed code
          </label>
          <textarea
            readOnly
            rows={4}
            value={embedCode}
            className="input-dark w-full resize-none font-mono !text-[11px] leading-relaxed"
            onFocus={(e) => e.target.select()}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                className="accent-brand"
                checked={autosize}
                onChange={(e) => setAutosize(e.target.checked)}
              />
              Autosize embed height
            </label>
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => void copyEmbed()}>
              {copied === 'embed' ? <Check size={13} /> : <Copy size={13} />}
              Copy embed code
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
